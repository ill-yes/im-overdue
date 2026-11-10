# Documentation

[English](README.md) · [Deutsch](de/README.md) · [Project home](../README.md)

Start with what you want to do. You can record working time straight away;
imported activities are optional evidence to help you remember your week.

## Choose your next step

### 🚀 Install and self-host

Get your own instance running, then keep its data safe.

[Start with Docker Compose](docker.md#start-with-compose) ·
[Set up Unraid](docker.md#unraid) ·
[Run locally with Node.js](development.md#run-locally)

### 🔧 Keep your instance running

Check its status, update the image and keep a recoverable copy of your data.

[Everyday commands](docker.md#everyday-commands) ·
[Choose an image version](docker.md#image-versions) ·
[Update or change the password](docker.md#change-the-password-or-update) ·
[Back up and restore](docker.md#backup-and-offline-restore)

### 📅 Record and review your time

Check your settings, record a working day and review completed weeks.

[Record your first day](usage.md#record-a-working-day) ·
[Close weeks and understand balances](usage.md#close-weeks-and-read-balances) ·
[Export a timesheet](usage.md#export-a-timesheet)

### ⚖️ Manage your account and absences

Start a running hours account, record payouts and corrections, and combine
vacation, time off in lieu and sickness with the holidays that apply to you.

[Set up your hours account](usage.md#hours-account) ·
[Record absences](usage.md#absences) ·
[Configure public holidays](usage.md#public-holidays) ·
[Holiday rules and scope](holiday-rules.md)

### 🔌 Prepare activity imports

Bring calendar, Slack or GitHub evidence from your own exporter into named sources.

[Import in the app](usage.md#import-activity) ·
[JSON/CSV format](import-format.md) ·
[Limits and example files](import-format.md#limits-and-examples)

### 🛠️ Develop and contribute

Run the project, understand its boundaries and check your changes.

[Development setup and checks](development.md) ·
[Local import API](import-format.md#local-api) ·
[Contribution terms](../CONTRIBUTING.md)

## Find a solution

- **Browser address rejected?** Check the [exact configured origin](docker.md#start-with-compose).
- **Data directory rejected at startup?** Check [allowed files and permissions](docker.md#persistent-storage-and-permissions).
- **No confirmed account balance?** Set an effective [opening balance](usage.md#hours-account).
- **Holiday or absence credit unexpected?** Review [daily precedence](usage.md#absences) and [holiday exceptions](usage.md#public-holidays).
- **Timesheet empty?** Check the [period, closed-week filter and optional account section](usage.md#export-a-timesheet).
