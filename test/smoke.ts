import GroupAdminPlugin, { SchedulerPlugin, SchedulerService } from '../src';

if (!GroupAdminPlugin || !SchedulerPlugin || !SchedulerService) {
  throw new Error('Plugin exports are not loadable.');
}
