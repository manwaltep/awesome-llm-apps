# 🪡 Needle — Woolworths and Coles with Jev and Voice

Needle is a Chrome side-panel shopping companion built on the open-source Jev search project. Keep a shopping list open across tabs, ask Jev to find products in the official Woolworths and Coles catalogues, or talk with Voice. The original meaning search and React playground remain available too.

## Features

- **Search by meaning.** Ask a question, describe an idea, or type a half-remembered detail.
- **Find the sentence that matters.** Bright green highlights the strongest sentence; pale green keeps the surrounding context visible.
- **Stay on the page.** Open the Chrome extension on a webpage and jump between matching passages.
- **Search both catalogues.** Jev ranks visible product cards from official Woolworths and Coles pages in separate tabs and links results to their source pages.
- **Talk with Voice.** Voice is a live speech-to-speech conversation. After a voice search, Voice reads Jev's sourced catalogue matches aloud and asks which exact match, if any, to add.
- **Keep one shopping list across tabs.** The list and separate notes field are stored in the current Chrome profile. Accepted catalogue items keep their retailer label. Voice adds to Needle's shared list; it does not add products to a retailer checkout cart.
- **Explore your own text.** Paste an article, policy, or document into the React app, or start with one of the included examples.
- **Read the original source.** Results point to existing text, with a relevance ranking and a copy button in the React app.

## How It Works

1. The extension opens the official Woolworths and Coles search pages in separate tabs and extracts visible product-card text after you grant access to those sites.
2. The text query and product passages go to the Needle backend. TypeSafe Jev ranks them and selects relevant original source text.
3. Voice uses `gpt-realtime-2.1` for direct speech-to-speech. `gpt-4o-mini-transcribe` supplies the transcript shown in the app; Jev receives the text only. After Jev returns sourced matches, the app passes the top choices to Voice to summarize aloud.
4. A clear spoken choice adds only that exact sourced item, with its retailer label, to Needle's shared list. A vague “yes” when multiple results were found prompts Voice to ask which one. `gpt-5.4-mini` interprets other explicit list requests, while a deterministic guard prevents catalogue results or suggestions from checking off an item; the shopper must explicitly confirm finding it in store, picking it up at the store, buying it, or putting that listed item in a trolley/cart/basket.

The backend sends Jev evaluations to TypeSafe's [System One API](https://docs.typesafe.ai/api). If you use a Vercel AI Gateway key instead, it routes through [Vercel AI Gateway's evaluation API](https://vercel.com/docs/ai-gateway/modalities/evaluation). Jev selects source sentences rather than generating an answer. Results with relevance scores of at least `0.58` are included; this is a ranking threshold, not a guarantee that every relevant passage was found.

## How to Get Started

Requires **Node.js 22.12+**, npm, and a TypeSafe API key for direct Jev access, or a Vercel AI Gateway key with access to Jev. Voice and transcript-based list updates require an **OpenAI API key**.

```sh
git clone https://github.com/manwaltep/awesome-llm-apps.git
cd awesome-llm-apps/advanced_llm_apps/needle
npm ci
cp .env.example .env
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp`.

Open `.env` in your editor and fill in both provider keys:

```dotenv
TYPESAFE_API_KEY=your_typesafe_jev_key
OPENAI_API_KEY=your_openai_api_key
```

The TypeSafe key powers Jev directly. The backend also recognizes a TypeSafe `apikey_` key saved under the older `AI_GATEWAY_API_KEY` name, or a Vercel AI Gateway key in that variable. The OpenAI key powers Voice and text-only list updates. Keep provider keys on the server; never put them in the extension or a `VITE_` variable.

## Run the App

Start the React app and its backend:

```sh
npm run dev
```

Open **http://127.0.0.1:4199** in your browser. This starts the UI and backend together and creates a downloadable extension ZIP. Keep the terminal running while using the extension. `.env` is loaded at server startup; restart after changing it. The local server binds only to your computer’s loopback interface.

Never put provider keys in the extension, a `VITE_` environment variable, a screenshot, or a committed file. `.env` is ignored by Git. The optional `AI_GATEWAY_KEY_FILE` setting can read an existing local key file instead; ordinary users only need `.env`.

## Install the Chrome Extension

The extension is included in this repository. Install it directly in Chrome using Developer mode.

No separate extension build is needed to load the source:

1. Open `chrome://extensions` in Chrome and enable **Developer mode**.
2. Choose **Load unpacked** and select **`awesome-llm-apps/advanced_llm_apps/needle/extension/`** folder. This is the folder containing `manifest.json`. Do not select the repository root or a ZIP file.
3. Pin Needle from Chrome’s puzzle-piece menu. The settings page opens on first installation; you can also right-click the icon and choose **Options**.
4. Set **Needle server URL** to `http://127.0.0.1:4199`. Leave **Server access token** blank for the default local setup. Click **Save connection**.
5. Open Needle from the toolbar. Use **Allow catalogue access** (or submit a text search) to let Jev read Woolworths and Coles pages. The first time you start Voice, Needle opens a full tab for Chrome’s microphone permission prompt. Choose **Allow**, return to Needle, then click **Start voice** again.

The extension side panel stays open as you change tabs. Press **Cmd+Shift+Y** on macOS or **Ctrl+Shift+Y** elsewhere to open Needle’s original current-page meaning search. If the shortcut is already in use, assign one at `chrome://extensions/shortcuts`.

**ZIP installation:** use **Get the extension** in the running playground, or run `npm run package:extension`. Unzip the package into a permanent folder and choose that folder in **Load unpacked**. Downloading or double-clicking a ZIP does not install it automatically. This follows Chrome’s [unpacked extension installation flow](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked).

**Updates:** pull the new source (or replace the extracted ZIP files), click **Reload** on Needle’s card in `chrome://extensions`, then refresh the webpage before reopening Needle. Keep the same extension folder to retain settings.

## How to Use Needle

### Search the catalogues

Type a product request such as “oat milk under $4” and choose **Search**. Needle opens or updates separate Woolworths and Coles search tabs while keeping the side panel open. Jev ranks visible product cards and shows only matches over its relevance threshold. Select **Open retailer page** to continue on the source site.

Product layouts change. If Jev reports no readable product cards, inspect the retailer tabs and search again. Prices and offers can change on the source site; Needle shows only text captured from those pages. For a voice search, Voice reads up to three top matches and asks before adding one exact choice to the Needle list. This does not place anything in a retailer's checkout cart.

### Speak with Voice

Choose **Start voice** and allow microphone access. Once the **Connected** badge appears, Voice gives a short introduction and explains how Jev and the shopping list work. Voice replies aloud and its transcript appears in the panel. Jev separately searches the text transcript; it does not receive speech audio. Once Jev returns, Voice speaks the sourced matches, then asks before adding the exact item the shopper chooses. If multiple matches were found, saying just “yes” does not add anything; choose the item by name or number. Needle only updates its shared shopping list, not Woolworths or Coles checkout carts.

### Shopping list and notes

The list is stored in `chrome.storage.local` and shared across tabs in the same Chrome profile. You can add, remove, or check off items manually. Voice adds a catalogue match only after you clearly choose or approve it, and stores its Woolworths/Coles label with that exact product. Direct requests to add a named item can also add that item. Needle does not edit retailer checkout carts. It may check an item off only after you explicitly confirm that you found it in store, picked it up at the store, bought it, or put it in a trolley/cart/basket. Notes are a separate freeform field.

### On a webpage

Keep `npm run dev` running, open the webpage you want to search, and use the panel’s **Find on this page** link or the **Cmd/Ctrl+Shift+Y** shortcut. Type what you mean, such as “costs beyond the advertised price” or “what happens if I cancel?” Needle highlights relevant source sentences.

### In the React app

Open **http://127.0.0.1:4199**, choose a document from the library, and type your query. To search your own content, open the library with the top-left toggle if it is hidden, choose **Bring your own text**, enter a title and the text, then select **Start exploring**. Click a result to jump to its source.

### PDFs

Needle currently searches webpage text. Chrome's built-in PDF viewer renders PDFs inside a separate browser viewer, so Needle's page script cannot read and highlight the PDF text as ordinary webpage elements. Enabling file access does not add PDF support.

For a PDF with selectable text, copy the relevant text and use **Bring your own text** in the React app. Scanned PDFs need text extraction with OCR first. Direct PDF upload and highlights inside the PDF viewer are not implemented.

### Troubleshooting

| What you see                                 | What to do                                                                                                                                                                                                                          |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cannot reach Needle                          | Start `npm run dev` and use `http://127.0.0.1:4199` as the extension's server URL. Keep that terminal running.                                                                                                                      |
| Jev key or credits error                     | Check that `TYPESAFE_API_KEY` contains a TypeSafe Jev API key, or that `AI_GATEWAY_API_KEY` contains a Vercel AI Gateway key. Check account access and credits, then restart the server.                                            |
| Voice or transcript list updates unavailable | Check `OPENAI_API_KEY` in `.env`, then restart the local server.                                                                                                                                                                    |
| Microphone permission dismissed              | Open `chrome://extensions` → Needle → **Details** → **Site settings** and allow the microphone. On macOS, also allow Chrome in System Settings → Privacy & Security → Microphone. Return to Needle and click **Start voice** again. |
| Chrome shows a retailer reload banner        | Reload the Woolworths or Coles page once so Chrome applies the catalogue access you just granted.                                                                                                                                   |
| Chrome cannot find the manifest              | Choose the `extension/` folder containing `manifest.json`. If using the download, unzip it first.                                                                                                                                   |
| Changes do not appear                        | Reload Needle at `chrome://extensions`, then refresh the webpage.                                                                                                                                                                   |
| No searchable text                           | Try a regular webpage. Built-in PDF viewers, browser settings pages, images and scanned text are unsupported.                                                                                                                       |

## API Key and Connection Settings

| Setting               | Where to put it                                                | Purpose                                                                      |
| --------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `TYPESAFE_API_KEY`    | Backend `.env`, or Vercel project environment variables        | Authenticates direct TypeSafe Jev API calls; never goes into the extension   |
| `AI_GATEWAY_API_KEY`  | Backend `.env`, or Vercel project environment variables        | Optional Vercel AI Gateway credential for Jev; never goes into the extension |
| `OPENAI_API_KEY`      | Backend `.env`, or Vercel project environment variables        | Realtime Voice and GPT-5.4-mini list intent; never goes into the extension   |
| `NEEDLE_ACCESS_TOKEN` | Backend environment, then the same value in extension settings | Protects access to your backend; required on Vercel, optional locally        |
| Needle server URL     | Extension settings                                             | Your local backend or your own HTTPS deployment                              |

For the web playground on a protected backend, enter the access token in **How it works → Server access token**. This is a separate app-specific token, not the Jev provider key. Searches use the TypeSafe or Vercel account configured on the backend.

## Optional: Deploy to Vercel

1. Import your fork into Vercel. Set **Root Directory** to `advanced_llm_apps/needle` and Framework Preset to **Vite**. The included `vercel.json` specifies the build output and API function duration.
2. Add `TYPESAFE_API_KEY` (or `AI_GATEWAY_API_KEY` if using Vercel AI Gateway), `OPENAI_API_KEY`, and a randomly generated `NEEDLE_ACCESS_TOKEN` to the project’s environment variables. For example, generate the access token with:

   ```sh
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

3. Deploy. In extension settings, use your deployment’s HTTPS origin and the access token. Allow access to that server when Chrome prompts you.
4. Jev search and transcript-based list updates use Vercel API routes. Realtime Voice requires a WebSocket server; the included WebSocket endpoint runs in the local Node server and is not hosted by Vercel Functions.
5. `/api/health` confirms whether keys are configured; it does not validate the keys or account credits.

The backend refuses search requests on Vercel if `NEEDLE_ACCESS_TOKEN` is missing. Use the token only for your own installation or a small trusted group. A general public service needs individual user authentication, rate limits, quotas and a billing decision; this template does not implement those. If Vercel Deployment Protection is enabled, the extension cannot complete its browser-login challenge. Use a backend reachable by the extension and retain Needle’s token check.

## Project Structure

```text
needle/
|-- src/                  React app, components, styles and example documents
|-- extension/            Chrome extension, persistent side panel, settings and page search
|-- server/               Local server, Jev requests, list intent and Realtime WebSocket proxy
|-- api/                  Vercel API functions
|-- public/               App assets and generated extension download
|-- scripts/              Extension ZIP packaging
|-- tests/                Search, sentence, access and packaging checks
|-- .env.example          API key and optional settings
`-- README.md
```

## Data Handling and Limits

- Catalogue search reads visible product-card text only after you invoke a search and grant access to Woolworths and Coles. It sends the search text and captured passages to the configured backend, then to Jev through TypeSafe System One or the configured Vercel AI Gateway.
- Page search runs only when you invoke it. It does not collect password/input values, browsing history, cookies, or screenshots.
- When you start Voice, Needle requests microphone permission in a full extension tab because Chrome may dismiss prompts requested from the side panel. The permission check stops its audio stream immediately. Once connected, Voice speaks an introduction; microphone audio then travels through the local Needle server to the OpenAI Realtime API. Its transcript is shown in the panel and passed as text for Jev search and GPT-5.4-mini list-action interpretation.
- The backend does not intentionally persist or log page text or transcripts. Hosting and model-provider policies still apply. The extension stores the shopping list, notes, server URL and app access token in Chrome local storage.
- Up to **160 passages / 60,000 characters**, with at most **2,200 characters per passage**. The extension skips oversized passages and reports omissions. Very long pages may only be partially searched. Pasted text is split into bounded passages.
- Chrome system pages, the Chrome Web Store, built-in PDF viewers, scanned text, cross-origin frames and shadow-root content are unsupported. Dynamic page changes may invalidate results; search again.
- Jev access/credit errors appear explicitly. There are no fabricated fallback matches.

## Development

```sh
npm test
npm run format:check
npm run build
npm run preview
```

Stop the dev server before running preview on the same port, or choose another `PORT` in `.env`. Preview serves the production build and the real local backend.

`npm run package:extension` produces:

- `artifacts/needle-extension-v1.2.5.zip` for release attachment.
- `public/needle-extension.zip` for the app’s download link; production builds copy it to `dist/`.

ZIP packaging uses an explicit file allowlist and does not include the backend, `.env`, dependencies or development output. Build artifacts are not committed.

Before sharing a package, load it in Chrome and check the connection, search, highlights and navigation. Automated tests do not cover Chrome’s installation and permission prompts.

Licensed under the repository’s [Apache-2.0 license](../../LICENSE).
