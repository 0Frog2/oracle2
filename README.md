# Oracle 2

A private, offline-first day-to-day assistant that runs on Android, iPhone, Windows, Mac and Linux.

- **Money** – custom needs / wants / savings split for every paycheck, "safe to spend" today and this week, bills & subscriptions timeline, wishlist, savings goals and leftovers.
- **Gym** – import workouts from Hevy (share or paste), progress per exercise, sets per muscle group, weight & waist trends, tips.
- **Records** – people & birthdays with gift ideas, tasks and notes.
- **Calendar** – everything you did or have to do, per day.
- **Reminders** – birthdays and bills at least a week ahead, weekly summary on Mondays.

## Use it
Open the app's address and install it: Android → Chrome menu → *Install app*; iPhone → Safari Share → *Add to Home Screen*; desktop → install icon in Edge/Chrome's address bar. A welcome tour explains the rest, and the **Help** page is always one tap away.

## Privacy
There is no server and no account. Your data is stored only on your device (IndexedDB). Optional sync encrypts everything on the device (AES-256-GCM, key derived from your passphrase) and stores the encrypted copy in a secret gist on **your own** GitHub account.

## Updating
Change the files, bump `VERSION` in `sw.js` (and `APP_VERSION` in `app.js`), push. Installed copies download the update on their next open and show an *Update now* banner. Data is never touched by updates; format changes are handled by `migrate()` in `app.js`.

No build step, no dependencies — plain HTML, CSS and JavaScript.
