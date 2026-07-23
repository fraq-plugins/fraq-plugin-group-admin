# README configuration type checklist
SUMMARY: Always keep one typed README configuration row for every GroupAdminPluginOptions property, using the project's compact `int` / `str` / `bool` / `list[...]` / `dict[...]` notation.
READ WHEN: before adding, changing, or removing GroupAdminPluginOptions properties or the README configuration table

---

Type notation:
- TypeScript `number` validated as an integer -> `int`
- `string` -> `str`
- `boolean` -> `bool`
- `number[]` -> `list[int]`
- `string[]` -> `list[str]`
- `Record<string, string>` -> `dict[str, str]`
- `Record<string, string[]>` -> `dict[str, list[str]]`

Keep the README table columns in this order: `选项 | 数据类型 | 默认值 | 说明`. After changing options, compare the interface property names and table option names in both directions so missing and stale rows are caught.
