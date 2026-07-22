import { type Context, type Disposable, definePlugin } from '@fraqjs/fraq';

export interface SchedulerPluginOptions {
  startupTimeoutMs?: number;
  heartbeatIntervalMs?: number;
}

type TimerHandle = ReturnType<typeof setTimeout>;

class CronField {
  private readonly allowed = new Set<number>();

  constructor(
    private readonly min: number,
    private readonly max: number,
    text: string,
  ) {
    this.parse(text);
  }

  matches(value: number): boolean {
    return this.allowed.has(value);
  }

  private parse(text: string): void {
    for (const part of text.split(',')) {
      this.parsePart(part.trim());
    }

    if (this.allowed.size === 0) {
      throw new Error('时间表达式字段不能为空');
    }
  }

  private parsePart(part: string): void {
    if (part === '*') {
      this.addRange(this.min, this.max, 1);
      return;
    }

    const [rangeText, stepText] = part.split('/');
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step <= 0) {
      throw new Error(`时间表达式步长无效：${part}`);
    }

    if (rangeText === '*') {
      this.addRange(this.min, this.max, step);
      return;
    }

    if (rangeText.includes('-')) {
      const [startText, endText] = rangeText.split('-');
      const start = Number(startText);
      const end = Number(endText);
      this.addRange(start, end, step);
      return;
    }

    const value = Number(rangeText);
    this.addRange(value, value, step);
  }

  private addRange(start: number, end: number, step: number): void {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < this.min || end > this.max || start > end) {
      throw new Error(`时间表达式范围无效：${start}-${end}`);
    }

    for (let value = start; value <= end; value += step) {
      this.allowed.add(value);
    }
  }
}

export class TimeExpression {
  private readonly minute: CronField;
  private readonly hour: CronField;
  private readonly dayOfMonth: CronField;
  private readonly month: CronField;
  private readonly dayOfWeek: CronField;

  constructor(text: string) {
    const fields = text.trim().split(/\s+/u);
    if (fields.length !== 5) {
      throw new Error('时间表达式必须是 5 段格式：分 时 日 月 周');
    }

    this.minute = new CronField(0, 59, fields[0] as string);
    this.hour = new CronField(0, 23, fields[1] as string);
    this.dayOfMonth = new CronField(1, 31, fields[2] as string);
    this.month = new CronField(1, 12, fields[3] as string);
    this.dayOfWeek = new CronField(0, 6, fields[4] as string);
  }

  matches(date: Date): boolean {
    return (
      this.minute.matches(date.getMinutes()) &&
      this.hour.matches(date.getHours()) &&
      this.dayOfMonth.matches(date.getDate()) &&
      this.month.matches(date.getMonth() + 1) &&
      this.dayOfWeek.matches(date.getDay())
    );
  }
}

export function validateCronExpression(expressionText: string): void {
  new TimeExpression(expressionText);
}

class DateTimeParser {
  private readonly now: Date;

  constructor(now = new Date()) {
    this.now = now;
  }

  parse(text: string): Date {
    const normalized = text.trim();

    return (
      this.tryParseMonthDayTime(normalized) ??
      this.tryParseDayTime(normalized) ??
      this.tryParseTime(normalized) ??
      this.throwFormatError()
    );
  }

  private tryParseMonthDayTime(text: string): Date | undefined {
    const match = /^(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text);
    if (!match) {
      return undefined;
    }

    const [, monthText, dayText, hourText, minuteText, secondText] = match;
    const year = this.now.getFullYear();
    const month = Number(monthText);
    const day = Number(dayText);
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = Number(secondText ?? '00');

    const thisYear = this.createValidatedDate(year, month, day, hour, minute, second);
    if (thisYear.getTime() > this.now.getTime()) {
      return thisYear;
    }

    return this.createValidatedDate(year + 1, month, day, hour, minute, second);
  }

  private tryParseDayTime(text: string): Date | undefined {
    const match = /^(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text);
    if (!match) {
      return undefined;
    }

    const [, dayText, hourText, minuteText, secondText] = match;
    const year = this.now.getFullYear();
    const month = this.now.getMonth() + 1;
    const day = Number(dayText);
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = Number(secondText ?? '00');

    const date = this.createValidatedDate(year, month, day, hour, minute, second);
    if (date.getTime() <= this.now.getTime()) {
      throw new Error('时间必须晚于当前时间');
    }

    return date;
  }

  private tryParseTime(text: string): Date | undefined {
    const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text);
    if (!match) {
      return undefined;
    }

    const [, hourText, minuteText, secondText] = match;
    const year = this.now.getFullYear();
    const month = this.now.getMonth() + 1;
    const day = this.now.getDate();
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = Number(secondText ?? '00');

    const date = this.createValidatedDate(year, month, day, hour, minute, second);
    if (date.getTime() > this.now.getTime()) {
      return date;
    }

    return this.createValidatedDate(year, month, day + 1, hour, minute, second);
  }

  private createValidatedDate(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    second: number,
  ): Date {
    const date = new Date(year, month - 1, day, hour, minute, second, 0);
    if (
      Number.isNaN(date.getTime()) ||
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day ||
      date.getHours() !== hour ||
      date.getMinutes() !== minute ||
      date.getSeconds() !== second
    ) {
      throw new Error('时间格式无效');
    }
    return date;
  }

  private throwFormatError(): never {
    throw new Error('时间格式必须是 HH:mm[:ss]、dd HH:mm[:ss] 或 MM-dd HH:mm[:ss]');
  }
}

export class SchedulerService implements Disposable {
  private readonly timers = new Set<TimerHandle>();

  constructor(private readonly ctx: Context) {}

  after(delayMs: number, callback: () => void | Promise<void>): TimerHandle {
    const timer = this.ctx.timeout(delayMs, async () => {
      this.timers.delete(timer);
      await callback();
    });
    this.timers.add(timer);
    return timer;
  }

  every(intervalMs: number, callback: () => void | Promise<void>): TimerHandle {
    const timer = this.ctx.interval(intervalMs, callback);
    this.timers.add(timer);
    return timer;
  }

  at(when: Date, callback: () => void | Promise<void>): TimerHandle {
    const delayMs = Math.max(0, when.getTime() - Date.now());
    return this.after(delayMs, callback);
  }

  atText(datetimeText: string, callback: () => void | Promise<void>): TimerHandle {
    const parser = new DateTimeParser();
    return this.at(parser.parse(datetimeText), callback);
  }

  expression(expressionText: string, callback: () => void | Promise<void>): TimerHandle {
    const expression = new TimeExpression(expressionText);
    let lastExecutionKey: string | undefined;

    return this.every(1000, async () => {
      const now = new Date();
      if (!expression.matches(now)) {
        return;
      }

      const executionKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
      if (executionKey === lastExecutionKey) {
        return;
      }

      lastExecutionKey = executionKey;
      await callback();
    });
  }

  cancel(timer: TimerHandle): void {
    clearTimeout(timer);
    clearInterval(timer);
    this.timers.delete(timer);
  }

  dispose(): void {
    for (const timer of this.timers) {
      clearTimeout(timer);
      clearInterval(timer);
    }
    this.timers.clear();
  }
}

export const SchedulerPlugin = definePlugin({
  name: 'scheduler',
  provides: [SchedulerService],
  apply(ctx, _options?: SchedulerPluginOptions) {
    ctx.logger.info('已载入插件：scheduler');
    const scheduler = new SchedulerService(ctx);
    ctx.provide(SchedulerService, scheduler);
  },
});

export default SchedulerPlugin;
