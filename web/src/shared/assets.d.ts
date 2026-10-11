declare module "*.css";

import type { HTMLAttributes, Key, Ref } from "react";

type WebAwesomeAttributes = HTMLAttributes<HTMLElement> & {
  key?: Key;
  ref?: Ref<HTMLElement>;
};

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "wa-tooltip": WebAwesomeAttributes & {
        for?: string;
        placement?:
          | "top"
          | "top-start"
          | "top-end"
          | "bottom"
          | "bottom-start"
          | "bottom-end"
          | "left"
          | "left-start"
          | "left-end"
          | "right"
          | "right-start"
          | "right-end";
        trigger?: string;
      };
    }
  }
}
