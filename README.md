# Anki Gamma
Gaeilge phrase reader for Anki cards using [ABAIR](http://abair.ie).

## How to install

1. Copy `collection.media/_gamma.js` to `%APPDATA%\Anki2\User\collection.media`
2. Add the script to a new or existing card template HTML, e.g. `<script src="_gamma.js" charset="UTF-8" data-language="gaeilge" data-phrase="{{text:Back}}"></script>`
3. Preview a card to verify playback
4. Sync your deck to Ankiweb if configured

Generated audio is cached in IndexedDB to reduce repeat requests. Where the browser supports the Compression Streams API, WAV audio is gzip-compressed before storage; older entries remain readable, and browsers without compression support store audio uncompressed. `MAX_CACHE_SIZE_BYTES` limits the total estimated size of the cached audio data (50 MiB by default); least-recently-used entries are evicted to make room for new audio. Entries larger than the configured limit are not cached. You can adjust `MAX_CACHE_SIZE_BYTES` and `CACHE_EXPIRY_MS` at the top of `_gamma.js`; expiry defaults to 30 days. Cache-size accounting estimates UTF-16 string storage for uncompressed entries and uses compressed byte length for compressed entries; browser database overhead is not included.

On a review card, click the small version watermark in the bottom-right corner to open the audio-cache statistics overlay. Click outside it, press Escape, or use its Close button to dismiss it.

## Note on Cloze cards

The phrase variable for cloze cards should be `{{text:cloze:Text}}` to receive the completed but unformatted cloze phrase.
