import { APP_NAME } from "../types";
import { Logo } from "./Icons";

/** The logo and name at the top left of every page. It is a link to the fleet page. */
export function BrandLink() {
  return (
    <a className="logo" href="#/" aria-label={`${APP_NAME}, fleet`}>
      <Logo />
      {APP_NAME}
    </a>
  );
}
