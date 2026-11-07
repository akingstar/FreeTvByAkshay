# FreeTvByAkshay

A static, mobile-friendly TV-style web app for:
- Authorized live HLS streams (`.m3u8`)
- Your own / authorized MP4 or WebM videos
- Search, favorites, full-screen playback and browser-local library
- Installable PWA shell

## Deploy free with GitHub Pages

1. Create a **public** GitHub repository named `FreeTvByAkshay` (or any name).
2. Upload all files and folders from this project to the repository root. Keep `index.html` at the root.
3. Open **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select branch `main`, folder `/ (root)`, then **Save**.
6. Wait for the Pages deployment. The URL will look like `https://YOUR-USERNAME.github.io/FreeTvByAkshay/`.

## Add streams and videos

Use the form on the page. For a live stream, paste a direct HLS `.m3u8` URL that the broadcaster/provider authorizes you to embed. For a video, paste a direct MP4/WebM URL that you own or have permission to share.

The library and favorites are stored in that browser's local storage. They are not synchronized across devices. GitHub Pages is static hosting; it does not upload, transcode, or store your video files.

## Playback notes

- HLS playback uses the Hls.js CDN on browsers that support Media Source Extensions.
- Safari may play HLS natively.
- Some providers block embedding with CORS, referrer restrictions, geo-blocking, DRM, or expiring tokens. The app cannot bypass those restrictions.
- Use official broadcaster embed/player links where direct stream embedding is not permitted.
- Do not use pirated streams or redistribute content without permission.

## Local testing

Open `index.html` through a local static server (recommended) rather than `file://`, because PWA/service-worker features require HTTP/HTTPS. Any static server is fine.

## Privacy

No account or backend is included. User-added URLs and favorites stay in the browser's local storage. Anyone using the same browser profile can access them.
