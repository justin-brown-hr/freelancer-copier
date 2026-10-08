# Freelancer Project Copier

A Chrome/Edge extension that puts a copy icon on Freelancer.com project pages and copies the full project details in one click.

Works on both Freelancer UIs: the logged-in Angular app (dark or light theme) and the logged-out pages.

## Install

1. Unzip the folder somewhere permanent (the browser loads it from disk).
2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the `freelancer-copier` folder.
5. Reload any Freelancer tab that was already open.

If you are updating from an earlier version, press the refresh arrow on the extension card first, then reload the Freelancer tab.

## Where the icon appears

| Page | Placement |
|---|---|
| Project page | In the icon row beside the bookmark and share icons |
| Project page | A fixed **Copy project** button, bottom right |
| Project page | <kbd>Alt</kbd> + <kbd>C</kbd> copies without reaching for the icon |

Search and Browse pages are left untouched.

## What gets copied

Title, URL, budget, fixed vs hourly, bids, average bid, time left or posted time, project ID, client location and join date, verification badges, skills and the description.

```
Marketing Materials Design -- 2
https://www.freelancer.com/projects/adobe-creative-suite/Marketing-Materials-Design-2/details

Budget: ₹600.00 – 1,500.00 INR (Fixed price)
Bids: 0
Time left: 6 days, 23 hours
Project ID: 40702650
Client: Mumbai, India · Member since Sep 10, 2026
Verified: Identity, Payment, Deposit, Email
Skills: Graphic Design, Banner Design, Logo Design, Photoshop

Description:
I'm seeking a talented graphic designer to create eye-catching marketing materials...
```

Click the extension icon to switch to **Markdown** or **JSON**, or to leave the description out.

## How it reads the page

Freelancer's logged-in app uses generated class names that change without notice, so every field is read twice over: from known class names first (`PageProjectViewLogout-*`, `data-testid` hooks), then from the page's own text using patterns for currency amounts, bid counts, deadlines and project IDs. The icon is anchored to the bookmark or share control, falling back to the project title if neither is found.

Because Angular re-renders as you navigate, the script re-checks the page continuously and re-adds the button if it gets wiped — including when you move between projects without a full page load.

## If a button doesn't appear

Open DevTools on the Freelancer page, switch the console's context dropdown (top left of the console, usually says "top") to **Freelancer Project Copier**, and run:

```js
flcopyDebug()
```

It reports whether the URL was recognised as a project page, how many buttons are present, which control the icon was anchored to, and the exact data extracted. If `projectPage` is false, widen `PROJECT_PATH` at the top of `content.js`. If a single field is empty, inspect that element, copy its class, and add it to the selector list in `extractProject()`.

## Files

```
manifest.json   extension config
content.js      finds cards, extracts fields, formats and copies
content.css     button and toast styling
popup.html/js   format and inclusion settings
icons/          toolbar icons
```

## Permissions

`storage` for your settings, plus access to freelancer.com pages. Nothing leaves the browser — extraction and copying happen entirely in the tab.
