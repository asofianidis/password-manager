# Chrome Web Store listing

Copy these into the developer dashboard. The upload is
`extension/release/password-manager-extension-<version>-chrome-store.zip`
(`npm run build:extension && npm run pack:extension`). It's the Chrome build without the manifest
`key`, which the store rejects.

## Store listing tab

**Name** (from the manifest): Password Manager

**Summary** (the manifest description, 132 characters max):
Fill logins and forms from the Password Manager desktop app.

**Category:** Tools

**Language:** English

**Description:**

```
Right-click any field to fill it from the Password Manager desktop app. Your vault stays in the app on your computer; the extension never stores passwords.

This extension needs the Password Manager desktop app for Windows, macOS, or Linux:
https://github.com/asofianidis/password-manager/releases/latest

LOGINS
Right-click a username or password field and open the Password Manager submenu. It lists the saved logins for the site you're on; pick one and the app fills in the username and password. A password is only sent when the login's domain matches the page, and a login saved for https is never filled into a plain http page.

CARDS, IDS AND NOTES
"Notes, cards & IDs" works on any site:
• Fill matching fields: fills every field in the form that matches one of the item's fields, such as cardholder name, card number, expiry and security code, or the lines of an address note.
• Insert a field: puts one value into the field you right-clicked.

HOW IT CONNECTS
The extension talks to the desktop app through Chrome's native messaging, on your computer only. No network connection or account is involved. The first time, choose "Connect to Password Manager…" from the menu and approve the browser in the app. You can revoke it later under Settings → Browser.

PRIVACY
• The menu only shows titles and usernames. A password or card value is sent to the page only after you pick it.
• Nothing is filled while your vault is locked.
• The extension sends nothing to any server, has no analytics, and loads no remote code.

Works in Chrome and other Chromium browsers that install from the Chrome Web Store, such as Edge, Brave and Vivaldi.
```

**Graphics:**

| Asset | File |
| --- | --- |
| Store icon (128×128) | `extension/icons/icon-128.png` |
| Screenshot 1 (1280×800) | `extension/store/screenshot-1-logins.png` |
| Screenshot 2 (1280×800) | `extension/store/screenshot-2-forms.png` |
| Small promo tile (440×280) | `extension/store/promo-small-440x280.png` |

The HTML the images are rendered from is in `extension/store/src`. To regenerate one, run headless
Edge or Chrome with `--headless=new --hide-scrollbars --force-device-scale-factor=1
--window-size=1280,800 --screenshot=<out.png> <file.html>` (use `440,280` for the tile).

**Homepage URL:** https://github.com/asofianidis/password-manager

**Support URL:** https://github.com/asofianidis/password-manager/issues

## Privacy tab

**Single purpose:**

```
Fill usernames, passwords and other form fields on web pages from the Password Manager desktop app, chosen from the right-click menu.
```

**Permission justifications:**

| Permission | Justification |
| --- | --- |
| `contextMenus` | The extension's only interface is a "Password Manager" submenu on editable fields, which lists the logins, cards, IDs and notes the user can fill. |
| `nativeMessaging` | Logins and form data live in the Password Manager desktop app on the user's computer. Native messaging is the only channel between them, and nothing goes over the network. |
| `storage` | Stores the pairing token the desktop app issues when the user approves this browser, so they don't have to approve it again every session. |
| Host permission `<all_urls>` | Users fill logins and forms on any website they choose, so the content script that fills the right-clicked field has to be able to run on every site. It does nothing until the user picks an item from the menu. |

**Are you using remote code?** No, I am not using remote code.

**Data usage:** tick **Authentication information** (and **Personally identifiable information**
and **Financial and payment information**, because cards and IDs can be filled). Then tick all
three certifications:

- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:**
https://github.com/asofianidis/password-manager/blob/main/docs/PRIVACY.md
