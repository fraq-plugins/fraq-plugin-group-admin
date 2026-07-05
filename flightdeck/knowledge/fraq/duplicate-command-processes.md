# Fraq duplicate command responses trap
SUMMARY: When every command response appears multiple times, first check for multiple running bot processes connected to the same Milky endpoint.
READ WHEN: when Fraq commands or event handlers appear to run more than once per incoming message

---

Observed on 2026-07-05:
- `D:\bot\fraq-plugins` had three separate `pnpm start` process chains running.
- Each process loaded the same Fraq app, connected to the same Milky endpoint, and installed `GroupAdminPlugin`.
- One group command was therefore handled once by each process, producing three responses.

Windows check:

```powershell
Get-CimInstance Win32_Process -Filter "name = 'node.exe'" |
  Where-Object { $_.CommandLine -like '*D:\bot\fraq-plugins*' } |
  Select-Object ProcessId,ParentProcessId,CreationDate,CommandLine
```

Stop duplicates and restart one copy only.
