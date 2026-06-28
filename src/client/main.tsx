import { render } from "preact";
import { AdminGate } from "./admin-gate";
import { PublicBookPage } from "./public-book";
import { PublicBookSuccessPage } from "./public-book-success";
import { PublicPaySuccessPage } from "./public-pay-success";
import { PublicPayCancelledPage } from "./public-pay-cancelled";
import { PublicPayAppointmentPage } from "./public-pay-appointment";
import { PublicOfferPage } from "./public-offer";
import { PublicOfferSuccessPage } from "./public-offer-success";
import { PublicAnytimePage } from "./public-anytime";
import { PublicAnytimeSuccessPage } from "./public-anytime-success";
import "./styles.css";

const paySuccessMatch = /^\/pay\/success\/?$/.exec(window.location.pathname);
const payCancelledMatch = /^\/pay\/cancelled\/?$/.exec(window.location.pathname);
const payTokenMatch = /^\/pay\/([^/]+)\/?$/.exec(window.location.pathname);
const anytimeSuccessMatch = /^\/anytime\/success\/?$/.exec(window.location.pathname);
const anytimeServiceSuccessMatch = /^\/anytime\/([^/]+)\/success\/?$/.exec(window.location.pathname);
const anytimeServiceMatch = /^\/anytime\/([^/]+)\/?$/.exec(window.location.pathname);
const anytimeMatch = /^\/anytime\/?$/.exec(window.location.pathname);
const bookSuccessMatch = /^\/book\/([^/]+)\/success\/?$/.exec(window.location.pathname);
const bookMatch = /^\/book\/([^/]+)\/?$/.exec(window.location.pathname);
const offerSuccessMatch = /^\/offer\/([^/]+)\/success\/?$/.exec(window.location.pathname);
const offerMatch = /^\/offer\/([^/]+)\/?$/.exec(window.location.pathname);

if (paySuccessMatch) {
  render(<PublicPaySuccessPage />, document.getElementById("app")!);
} else if (payCancelledMatch) {
  render(<PublicPayCancelledPage />, document.getElementById("app")!);
} else if (payTokenMatch) {
  render(<PublicPayAppointmentPage token={payTokenMatch[1]} />, document.getElementById("app")!);
} else if (anytimeSuccessMatch) {
  render(<PublicAnytimeSuccessPage />, document.getElementById("app")!);
} else if (anytimeServiceSuccessMatch) {
  render(
    <PublicAnytimeSuccessPage serviceSlug={decodeURIComponent(anytimeServiceSuccessMatch[1])} />,
    document.getElementById("app")!,
  );
} else if (anytimeServiceMatch) {
  render(<PublicAnytimePage serviceSlug={decodeURIComponent(anytimeServiceMatch[1])} />, document.getElementById("app")!);
} else if (anytimeMatch) {
  render(<PublicAnytimePage />, document.getElementById("app")!);
} else if (bookSuccessMatch) {
  render(<PublicBookSuccessPage token={bookSuccessMatch[1]} />, document.getElementById("app")!);
} else if (bookMatch) {
  render(<PublicBookPage token={bookMatch[1]} />, document.getElementById("app")!);
} else if (offerSuccessMatch) {
  render(<PublicOfferSuccessPage slug={decodeURIComponent(offerSuccessMatch[1])} />, document.getElementById("app")!);
} else if (offerMatch) {
  render(<PublicOfferPage slug={decodeURIComponent(offerMatch[1])} />, document.getElementById("app")!);
} else {
  render(<AdminGate />, document.getElementById("app")!);
}
