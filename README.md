# WhatsApp LaTeX Render Bot

A modern, high-performance WhatsApp bot designed to run in group chats (or direct messages) and render LaTeX equations into beautiful, high-resolution images. It supports both single equation rendering and full-card text mixed with block equations.

## Key Features

- **Offline-First local rendering**: Uses a local headless browser (Puppeteer) and KaTeX to render LaTeX locally. Extremely fast, secure, and private.
- **Premium Aesthetics**: Renders math inside elegant, dark-slate floating cards with rounded corners, transparency, and drop shadows.
- **Automatic Delimiter Rendering**: Automatically detects messages containing `$$ ... $$` blocks and converts them into rich educational cards preserving the surrounding text.
- **Explicit Command Triggers**: Support for `!latex <formula>` and `!tex <formula>` commands.
- **Chemical Equation Support**: Built-in support for rendering chemical formulas via KaTeX `mhchem` extension (e.g., `\ce{H2O}`).
- **Robust Web Fallback**: Seamless fallback to external Web APIs (Codecogs) in case local Puppeteer fails, ensuring the bot is 100% resilient.
- **Persistent Sessions**: Uses `whatsapp-web.js` LocalAuth so you only need to scan the QR code once.

---

## Getting Started

### 1. Prerequisites
Ensure you have the following installed on your machine:
- **Node.js** (v18.0.0 or higher)
- **NPM** (usually comes with Node.js)

### 2. Installation
Clone or navigate to the project directory and install the dependencies:
```bash
npm install
```
*Note: This will download a compatible version of headless Chromium for local image rendering. This might take a minute.*

### 3. Verify Local Rendering (Test)
To verify that Puppeteer, KaTeX, and the rendering pipeline are configured correctly without connecting to WhatsApp, run the local test suite:
```bash
npm test
```
This script will initialize the local renderer and output test images in a folder named `test_output/`. You can open these images to inspect the rendering layout and quality.

### 4. Running the WhatsApp Bot
Start the bot application:
```bash
npm start
```
1. Once running, a QR code will be generated and printed inside your terminal.
2. Open **WhatsApp** on your phone.
3. Tap **Menu** or **Settings** and select **Linked Devices**.
4. Tap **Link a Device** and scan the QR code in the terminal.
5. The console will print `Bot "LaTeX Bot" is now connected and ready!` once authenticated.
6. The bot is now live! It will save its session in the `.wwebjs_auth/` directory, so you won't need to scan the QR code next time you start it.

---

## Configuration

You can customize the rendering look and bot triggers by editing `config.js`:
- **Colors & Style**: Change `style.backgroundColor` (hex color) or `style.textColor`. You can also configure margins, shadows, padding, and font-families.
- **Watermark**: Edit or disable the subtle watermark at the bottom of the rendered cards.
- **Auto Render Delimiter**: Set `bot.autoRenderBlock` to `false` to disable auto-rendering `$$ ... $$` messages and only respond to explicit commands.
- **Fallback Mode**: Customize `bot.useFallback` and the fallback engine if you want to bypass local browser automation.

---

## Usage in WhatsApp

Once connected, you can use the bot in any group chat where your WhatsApp account is present, or in direct messages.

### 1. Direct Command
Sends a clean card containing just the formatted math block.
- **Command**: `!latex <formula>` or `!tex <formula>`
- **Example**:
  ```text
  !latex \sum_{i=1}^{n} i = \frac{n(n+1)}{2}
  ```

### 2. Auto-Detect / Mixed Text Rendering
If a message contains text mixed with math equations wrapped in `$$`, the bot will capture the entire message context and render it as a single cohesive educational card.
- **Syntax**: `$$ <formula> $$`
- **Example**:
  ```text
  Here is the Euler identity:
  $$e^{i \pi} + 1 = 0$$
  This connects five fundamental constants.
  ```

### 3. Chemical Equations
Use `\ce{...}` inside your formulas:
- **Example**:
  ```text
  !latex \ce{CO2 + H2O <=> H2CO3}
  ```
