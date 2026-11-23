---
"@valbuild/cli": patch
---

**`val <command> --help` shows help instead of running the command.** `val publish --help` used to start a publish, and `val validate --version` ran a validation: `--help` and `--version` only worked when nothing else was on the line. Now `--help` / `-h` anywhere prints help and runs nothing, and after a command it prints that command's help alone. `--version` / `-v` prints the CLI's version the same way, and `val help <command>` works too. `val -h` and `val -v` used to print the full help and exit with an error; they now do what they say. An unknown command now exits with an error code too, so a typo in a CI step fails it.
