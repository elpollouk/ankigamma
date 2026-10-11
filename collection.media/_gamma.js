(function() {

const STYLE = `
.gamma button {
  color: #ffffff;
  border: none;
  padding: 10px 18px;
  font-size: 16px;
  border-radius: 8px;
  cursor: pointer;
  margin-top: 10px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  transition: background-color 0.2s ease;
}

.gamma button:active {
  transform: scale(0.9);
}
`;

const REQUESTS = {
    gaeilge: async (input) => {
        const response = await fetch("https://api.abair.ie/v4/synthesis", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Abair-Api-Key": "anon_abair",
            },
            body: JSON.stringify({ input, voice: "sibeal" }),
        });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const json = await response.json();
        if (!json.audioContent) {
            throw new Error("No audio content returned from the API.");
        }
        return `data:audio/wav;base64,${json.audioContent}`;
    },
}

// Extract the configuration for this playback element
const currentScript = document.currentScript;
if (!currentScript) {
    throw new Error("This script must be included in a <script> tag.");
}
const language = currentScript.dataset.language || 'gaeilge';
const phrase = currentScript.dataset.phrase || 'Dia duit';
const input = /%[0-9A-Fa-f]{2}/.test(phrase) ? decodeURIComponent(phrase) : phrase;

// Create the DOM elements to insert into the card and make sure they are available for the functions below to use
const root = document.createElement("div");
const requestButton = document.createElement("button");
const player = document.createElement("audio");

// Function to handle the request and playback of the audio
async function speak() {
    requestButton.disabled = true;

    if (!player.src) {
        requestButton.innerText = "⏳";
        const request = REQUESTS[language];
        player.src = await request(input);
    }

    await player.play();
}

function onerror(error) {
    alert(error.message);
    requestButton.disabled = true;
    requestButton.innerText = "❌";
}

// Make sure the style is only added once to the document
if (!document.querySelector('style.gamma')) {
  const style = document.createElement('style');
  style.className = 'gamma';
  style.textContent = STYLE;
  document.head.appendChild(style);
}

// Build the DOM for the playback element and insert it into the card
requestButton.innerText = "🔈";
requestButton.onclick = () => speak().catch(onerror);
player.hidden = true;
player.onplaying = () => {
    requestButton.innerText = "🔊";
};
player.onended = () => {
    requestButton.disabled = false;
    requestButton.innerText = "🔈";
};
root.classList.add("gamma");
root.appendChild(requestButton);
root.appendChild(player);

currentScript.insertAdjacentElement("beforebegin", root);
})();