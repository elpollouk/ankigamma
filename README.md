# Anki Gamma
Gaeilge phrase reader for Anki cards using [ABAIR](http://abair.ie).

## How to install

1. Copy `collection.media/_gamma.js` to `%APPDATA%\Anki2\User\collection.media`
2. Add the script to a new or existing card template HTML, e.g. `<script src="_gamma.js" charset="UTF-8" data-language="gaeilge" data-phrase="{{text:Back}}"></script>`
3. Preview a card to verify playback
4. Sync your deck to Ankiweb if configured

## Note on Cloze cards

The phrase variable for cloze cards should be `{{text:cloze:Text}}` to receive the completed but unformatted cloze phrase.
