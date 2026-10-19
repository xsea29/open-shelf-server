# Open Shelf server

The API behind the [Open Shelf](../open_self) app. It searches **LibGen**, using the search and parsing logic of [libgen-downloader](https://github.com/obsfx/libgen-downloader), and hands the app a direct download link for a book. The app saves the file itself.

It is a separate project because the app cannot do this on its own: a browser or phone WebView is blocked from reading LibGen's pages (CORS), so a server has to.

## Run it

```bash
npm install
npm run dev        # restarts on changes
npm start          # plain run
npm run typecheck
```

| Variable | Default | |
| --- | --- | --- |
| `PORT` | `8787` | Port to listen on. Hosting platforms set this for you. |
| `LIBGEN_MIRROR` | from libgen-downloader's config | Use this one LibGen mirror, for example `https://libgen.gl/`. |

## API

| Request | Answer |
| --- | --- |
| `GET /health` | `{ "ok": true }`, for health checks |
| `GET /api/search?q=&page=&pageSize=` | `{ items: Book[], total, hasMore }`. `page` is 1-based, `pageSize` at most 25. |
| `GET /api/books/:id` | One book seen in an earlier search, or 404. |
| `GET /api/books/:id/download` | `{ url }`, the direct file link for the book (`:id` is the LibGen md5). |

Only EPUB and PDF files are returned. The types are in `src/types.ts`; the app keeps the same ones in `src/data/types.ts`, so change both together. CORS is open (`*`) and there is no authentication.

## Use it from the app

In the app project, set where the API lives and rebuild:

- **Development:** run this server (port 8787) next to `npm run dev` in the app. The app's Vite dev server forwards `/api` to `http://localhost:8787`.
- **Phone build:** put the public address in the app's `.env.production.local`, then run `npm run cap:sync` there and rebuild the APK:

  ```
  VITE_API_BASE=https://your-server.example.com/api
  ```

  Use an `https://` address. Release builds of the app refuse plain `http`.

## Deploy it

Any host that runs Node 20 or newer works. It needs outbound internet access to reach LibGen, and nothing else (no database, no storage).

**Docker** (Fly.io, Render, Railway, Cloud Run, a VPS):

```bash
docker build -t open-shelf-server .
docker run -p 8787:8787 open-shelf-server
```

**Without Docker:** build command `npm ci`, start command `npm start`, health check path `/health`.

Things to check after deploying:

- LibGen's download links may be tied to the address that asked for them. The server asks for the link and the phone downloads the file, so test one real download from the phone before relying on it.
- Some LibGen mirrors refuse traffic from cloud providers. If search fails with "No LibGen mirror responded", try setting `LIBGEN_MIRROR`.
- Check your host's acceptable-use policy. LibGen holds a lot of copyrighted material, and some hosts suspend accounts that proxy it.
- There is no rate limiting or authentication, so anyone who finds the address can use it.
