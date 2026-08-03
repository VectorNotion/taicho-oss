# Lead Capture Chrome Extension

Captures leads from LinkedIn Sales Navigator into the content automation system.

## Installation (Development)

1. **Generate Icons** (required):
   ```bash
   # Install ImageMagick if needed
   brew install imagemagick

   # Generate PNG icons from SVG
   cd extension/icons
   convert -background none icon.svg -resize 16x16 icon16.png
   convert -background none icon.svg -resize 48x48 icon48.png
   convert -background none icon.svg -resize 128x128 icon128.png
   ```

2. **Load in Chrome**:
   - Open `chrome://extensions/`
   - Enable "Developer mode" (top right)
   - Click "Load unpacked"
   - Select the `extension` folder

3. **Configure**:
   - Click the extension icon
   - Click settings (gear icon)
   - Set your API URL (default: `http://localhost:3000`)

## Usage

1. Navigate to a LinkedIn Sales Navigator profile
   - URLs like: `linkedin.com/sales/lead/*` or `linkedin.com/sales/people/*`

2. Click the extension icon

3. Review the extracted lead data

4. Choose an action:
   - **Capture**: Creates lead with status "new"
   - **Capture & Research**: Creates lead and immediately starts AI research

## Files

```
extension/
├── manifest.json     # Chrome extension manifest (MV3)
├── popup.html        # Extension popup UI
├── popup.css         # Popup styling
├── popup.js          # Popup logic and API calls
├── content.js        # Data extraction from LinkedIn
├── icons/
│   ├── icon.svg      # Source icon
│   ├── icon16.png    # Toolbar icon
│   ├── icon48.png    # Extensions page
│   └── icon128.png   # Chrome Web Store
└── README.md
```

## API Endpoints Used

- `POST /api/outreach/leads` - Creates or updates lead
  - Deduplicates by LinkedIn URL (updates existing if found)
  - `triggerResearch: true` starts background research job

## Notes

- Content script only runs on Sales Navigator pages
- Data extraction uses multiple CSS selectors for robustness
- LinkedIn's DOM can change; selectors may need updates
