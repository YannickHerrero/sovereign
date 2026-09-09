//! Serves the built PWA from the binary. In debug builds rust-embed reads `pwa/dist` from disk,
//! so `pnpm build` in `pwa/` is enough to refresh it without recompiling.

use axum::extract::Path;
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use rust_embed::Embed;

#[derive(Embed)]
#[folder = "../pwa/dist/"]
struct Dist;

pub fn router() -> Router {
    Router::new().route("/", get(index)).route("/{*path}", get(file))
}

async fn index() -> Response {
    serve("index.html")
}

async fn file(Path(path): Path<String>) -> Response {
    serve(&path)
}

fn serve(path: &str) -> Response {
    match Dist::get(path) {
        Some(asset) => {
            let mime = mime_guess::from_path(path).first_or_octet_stream();
            // Hashed bundles can be cached forever; everything else must revalidate so a new
            // deploy is picked up (the service worker relies on a fresh sw.js / index.html).
            let cache = if path.starts_with("assets/") { "public, max-age=31536000, immutable" } else { "no-cache" };
            (
                [
                    (header::CONTENT_TYPE, HeaderValue::from_str(mime.as_ref()).unwrap()),
                    (header::CACHE_CONTROL, HeaderValue::from_static(cache)),
                ],
                asset.data.into_owned(),
            )
                .into_response()
        }
        // Client-side routes fall back to the app shell.
        None if !path.contains('.') => serve("index.html"),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}
