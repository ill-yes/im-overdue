# Security policy

## Supported versions

Security fixes are made for the latest release and the `main` branch. Please
update to the current container image before reporting an issue.

## Reporting a vulnerability

Please do not report security issues in public GitHub issues, discussions or
pull requests.

Report them privately through
[GitHub private vulnerability reporting](https://github.com/ill-yes/im-overdue/security/advisories/new)
instead. Include the affected version, your setup (Docker, Unraid or local),
the steps to reproduce and the impact you observed. Do not include real
passwords, session cookies or personal time data; synthetic data is enough.

You will get a reply as soon as possible. Once a fix is available, the issue
is disclosed in a security advisory, with credit if you would like it.

## Scope

I'm Overdue is a single-user, self-hosted app. Relevant reports include, for
example, authentication or session bypass, cross-origin requests that change
data, access to data outside the configured data directory, and injection
through imported files. Weak passwords chosen by the operator, or deployments
that ignore the [Docker guide](docs/docker.md), are out of scope.
