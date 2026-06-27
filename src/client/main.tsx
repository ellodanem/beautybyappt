import { render } from "preact";
import { App } from "./app";
import { PublicBookPage } from "./public-book";
import { PublicBookSuccessPage } from "./public-book-success";
import { PublicOfferPage } from "./public-offer";
import { PublicAnytimePage } from "./public-anytime";
import "./styles.css";

const anytimeServiceMatch = /^\/anytime\/([^/]+)\/?$/.exec(window.location.pathname);
const anytimeMatch = /^\/anytime\/?$/.exec(window.location.pathname);
const bookSuccessMatch = /^\/book\/([^/]+)\/success\/?$/.exec(window.location.pathname);
const bookMatch = /^\/book\/([^/]+)\/?$/.exec(window.location.pathname);
const offerMatch = /^\/offer\/([^/]+)\/?$/.exec(window.location.pathname);

if (anytimeServiceMatch) {
  render(<PublicAnytimePage serviceSlug={decodeURIComponent(anytimeServiceMatch[1])} />, document.getElementById("app")!);
} else if (anytimeMatch) {
  render(<PublicAnytimePage />, document.getElementById("app")!);
} else if (bookSuccessMatch) {
  render(<PublicBookSuccessPage token={bookSuccessMatch[1]} />, document.getElementById("app")!);
} else if (bookMatch) {
  render(<PublicBookPage token={bookMatch[1]} />, document.getElementById("app")!);
} else if (offerMatch) {
  render(<PublicOfferPage slug={decodeURIComponent(offerMatch[1])} />, document.getElementById("app")!);
} else {
  render(<App />, document.getElementById("app")!);
}
