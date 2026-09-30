---
pr: 93
title: Contacts
---
1. Open **Contacts** in the sidebar. Jane Doe, Priya Shah, Omar Haddad and J. Doe are notes in `People/`, and each shows when a note last mentioned them. Search for "acme", or filter by the #client tag or by company.
2. The banner says Jane Doe and J. Doe have the same email. Click **Merge into Jane Doe**: Jane gains J.'s second email and phone, "J. Doe" becomes one of her aliases, and the link in [[Initech demo]] now points at Jane. J. Doe's note is in Trash.
3. Open Jane Doe. Her page shows her details and the notes that mention her, newest first: [[Acme renewal call]], two days ago, and [[Initech demo]], after the merge. Click one to open it at that line. **Edit note** opens her note, where the details are the frontmatter.
4. In [[Who to call]], type `@pri` at the end: Priya Shah comes first, and picking her inserts `[[People/Priya Shah]]`. Type `@Dana Lee` and choose **Create contact “Dana Lee”**: the link goes in, and Dana appears in Contacts.
5. **Import** takes a vCard (`.vcf`, from a phone or Apple Contacts) or a CSV (Google or Outlook contacts, or your own columns: Name, Email, Company…). People already here, with the same email or name, get what's new, and everyone else becomes a contact.
6. Agents have `list_contacts`, `read_contact`, `create_contact`, `update_contact`, `merge_contacts` and `import_contacts`, and the CLI has `quire contacts` and `quire contact`.
