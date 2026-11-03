---
"@valbuild/ui": patch
"@valbuild/shared": patch
---

Search and a library entry's "used by" no longer freeze the Studio on a large `.jsonValues()` record.

Both have to see every entry of the records they look in. The Studio used to ask for those entries one request at a time and rebuild the record after each one, which grew with the square of the record's size: about a second for 1,000 entries, and most of a minute for 10,000. Now:

- entries are requested many to a request (`GET /json` with a list of keys), with at most three such requests at a time, so what you open meanwhile is not queued behind them;
- what arrives is applied a batch at a time, with the browser free to handle clicks and typing between batches;
- search and "used by" show a progress bar with how many entries are loaded, show what they have found so far, and offer **Try again** if some entries could not be loaded;
- closing search or leaving the entry stops the requests that have not been sent;
- the search index adds only the entries that arrived, rather than re-reading the whole record each time.

A record's rows on screen are now also fetched in one request rather than one per row.
