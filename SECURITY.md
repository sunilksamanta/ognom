# Security Policy

Ognom stores database credentials on your machine, so security reports are taken seriously.

## Supported versions

Only the latest release gets security fixes. Installed copies update themselves, so staying current is automatic.

| Version | Supported |
|---|---|
| 2.1.x (latest) | Yes |
| Older | No, please update |

## Reporting a vulnerability

**Please don't open a public issue.** Report it privately instead:

1. Go to the repository's [Security tab](https://github.com/sunilksamanta/ognom/security).
2. Click **Report a vulnerability** and describe the problem.

Useful details: what an attacker could do, steps to reproduce, the Ognom version and OS, and any proof of concept.

You'll get an acknowledgement within a few days. Once a fix ships, the advisory is published with credit to you, unless you'd rather stay anonymous.

## Scope

In scope:

- How saved credentials, connection strings and SSH secrets are stored, encrypted and exported
- The master key, the key file and the OS keychain integration
- SSH host key verification
- Bypassing the read-only / production write guard
- Code execution through crafted documents, connection strings or import files
- The update mechanism

Out of scope: vulnerabilities in MongoDB itself, and problems that require an attacker who already controls your user account.

## How Ognom protects your data

See the [security model](README.md#security-model) in the README.
