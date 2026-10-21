# Security

If you find a security problem in kopit, please don't open a public issue. Report it privately here instead:

https://github.com/pur3coff33/kopit/security/advisories/new

Include what you found, how to reproduce it, and what someone could do with it. I'll reply as soon as I can and let you know when a fix is out.

Things I especially want to hear about:

- getting into a household without its PIN, or getting around the lockout
- seeing or changing another household's data
- sessions that keep working after a PIN change or logout
- anything that exposes `PIN_PEPPER` or stored PIN hashes

Only the latest version on `main` gets fixes.
