---
pr: 161
title: Google Contacts
---
1. Open **Contacts** (Import file… at the top takes a vCard or CSV). The bar under the search says **Google Contacts**: click **Connect**, then **Allow** on the stand-in's consent page (Previews have no real Google). You come back to Contacts, and it syncs. Once connected, its **Manage** button opens Settings → **Integrations**: Calendar and Contacts side by side, Allow editing, Disconnect. A synced contact's page has **Open in Google**.
2. Jane Doe and Priya Shah were already here: they're linked (see **Synced: Google Contacts** on their page), keep their tags and notes, and gain what Google knows (Jane's work phone, Priya's second email). Jane's role was "CTO" here and "Chief Technology Officer" in Google: Google's wins, and her note's History has the old one. Lena Fischer, Marcus Webb and Sofia Rossi are new notes; Lena's has Google's note about her.
3. Open [the stand-in's address book](/auth/google/contacts/mock), change Lena's role, and press **Sync now** on Contacts: her note follows.
4. Add a phone to Lena here and press **Sync now**: it stays here ("edited here only"). Click **Manage**, then **Allow editing**, allow, and it goes to Google: the address book shows it.
5. Delete someone in the address book and press **Sync now**: their note stays, without the `google:` line.
6. Agents and the CLI: `commonink contacts google`, `commonink contacts sync`, MCP `google_contacts_status` and `sync_google_contacts`.
