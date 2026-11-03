import React from 'react';

export type IconName =
  | 'arrow-down-s'
  | 'arrow-right-s'
  | 'arrow-up-s'
  | 'check'
  | 'close'
  | 'expand-up-down'
  | 'file-code'
  | 'file-text'
  | 'git-branch'
  | 'git-commit'
  | 'layout-column'
  | 'loader-4'
  | 'node-tree'
  | 'refresh'
  | 'search'
  | 'chat-off'
  | 'text-wrap'
  | 'external-link';

export const Icon: React.FC<{
  name: IconName;
  className?: string;
  style?: React.CSSProperties;
}> = ({ name, className = 'oc-icon', style }) => {
  switch (name) {
    case 'arrow-down-s':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden="true">
          <path d="M12 13.1714L16.9497 8.22168L18.3639 9.63589L12 15.9999L5.63604 9.63589L7.05025 8.22168L12 13.1714Z" />
        </svg>
      );
    case 'arrow-right-s':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden="true">
          <path d="M13.1717 12.0007L8.22192 7.05093L9.63614 5.63672L16.0001 12.0007L9.63614 18.3646L8.22192 16.9504L13.1717 12.0007Z" />
        </svg>
      );
    case 'arrow-up-s':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden="true">
          <path d="M12 10.8284L7.05025 15.7782L5.63604 14.364L12 8L18.3639 14.364L16.9497 15.7782L12 10.8284Z" />
        </svg>
      );
    case 'check':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden="true">
          <path d="M9.9997 15.1709L19.1921 5.97852L20.6063 7.39273L9.9997 17.9993L3.63574 11.6354L5.04996 10.2212L9.9997 15.1709Z" />
        </svg>
      );
    case 'close':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden="true">
          <path d="M11.9997 10.5865L16.9495 5.63672L18.3637 7.05093L13.4139 12.0007L18.3637 16.9504L16.9495 18.3646L11.9997 13.4149L7.04996 18.3646L5.63574 16.9504L10.5855 12.0007L5.63574 7.05093L7.04996 5.63672L11.9997 10.5865Z" />
        </svg>
      );
    case 'expand-up-down':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden="true">
          <path d="M18.2072 9.0428L12.0001 2.83569L5.793 9.0428L7.20721 10.457L12.0001 5.66412L16.793 10.457L18.2072 9.0428ZM5.79285 14.9572L12 21.1643L18.2071 14.9572L16.7928 13.543L12 18.3359L7.20706 13.543L5.79285 14.9572Z" />
        </svg>
      );
    case 'file-code':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden="true">
          <path d="M21 8V20.9932C21 21.5501 20.5552 22 20.0066 22H3.9934C3.44495 22 3 21.556 3 21.0082V2.9918C3 2.45531 3.4487 2 4.00221 2H14.9968L21 8ZM19 9H14V4H5V20H19V9ZM17.5 13.5L15 16L13.59 14.59L14.67 13.5L13.59 12.41L15 11L17.5 13.5ZM6.5 13.5L9 11L10.41 12.41L9.33 13.5L10.41 14.59L9 16L6.5 13.5Z" />
        </svg>
      );
    case 'file-text':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden="true">
          <path d="M21 8V20.9932C21 21.5501 20.5552 22 20.0066 22H3.9934C3.44495 22 3 21.556 3 21.0082V2.9918C3 2.45531 3.4487 2 4.00221 2H14.9968L21 8ZM19 9H14V4H5V20H19V9ZM8 7H11V9H8V7ZM8 11H16V13H8V11ZM8 15H16V17H8V15Z" />
        </svg>
      );
    case 'git-branch':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden="true">
          <path d="M7.10508 15.21A3.00116 3.00116 0 1 1 5.00004 15.21V8.79A3.00116 3.00116 0 1 1 7.00004 8.79V11C7.00004 12.1046 7.89547 13 9.00004 13H15C16.1046 13 17 12.1046 17 11V8.79A3.00095 3.00095 0 1 1 19 8.79V11C19 13.2091 17.2092 15 15 15H9.00004C8.26797 15 7.58198 14.8033 6.99165 14.4596L7.10508 15.21ZM6.00004 7A1 1 0 1 0 6.00004 5A1 1 0 0 0 6.00004 7ZM18 7A1 1 0 1 0 18 5A1 1 0 0 0 18 7ZM6.00004 19A1 1 0 1 0 6.00004 17A1 1 0 0 0 6.00004 19Z" />
        </svg>
      );
    case 'git-commit':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden="true">
          <path d="M15.874 13C15.4299 14.7252 13.8638 16 12 16C10.1362 16 8.57006 14.7252 8.12602 13H3V11H8.12602C8.57006 9.27477 10.1362 8 12 8C13.8638 8 15.4299 9.27477 15.874 11H21V13H15.874ZM12 14C13.1046 14 14 13.1046 14 12C14 10.8954 13.1046 10 12 10C10.8954 10 10 10.8954 10 12C10 13.1046 10.8954 14 12 14Z" />
        </svg>
      );
    case 'layout-column':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden="true">
          <path d="M11 5H5V19H11V5ZM13 5V19H19V5H13ZM4 3H20C20.5523 3 21 3.44772 21 4V20C21 20.5523 20.5523 21 20 21H4C3.44772 21 3 20.5523 3 20V4C3 3.44772 3.44772 3 4 3Z" />
        </svg>
      );
    case 'loader-4':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden="true">
          <path d="M18.364 5.63604L16.9497 7.05025C15.683 5.7835 13.933 5 12 5C8.13401 5 5 8.13401 5 12C5 15.866 8.13401 19 12 19C15.866 19 19 15.866 19 12H21C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C14.4853 3 16.7353 4.00736 18.364 5.63604Z" />
        </svg>
      );
    case 'node-tree':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden="true">
          <path d="M5 3V19H11V21H3V3H5ZM21 15V21H13V15H21ZM19 17H15V19H19V17ZM21 7V13H13V11H7V9H13V7H21ZM19 9H15V11H19V9Z" />
        </svg>
      );
    case 'refresh':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden="true">
          <path d="M5.46257 4.43262C7.21556 2.91688 9.5007 2 12 2C17.5228 2 22 6.47715 22 12C22 14.1361 21.3302 16.1158 20.1892 17.7406L17 12H20C20 7.58172 16.4183 4 12 4C9.84982 4 7.89777 4.84827 6.46023 6.22842L5.46257 4.43262ZM18.5374 19.5674C16.7844 21.0831 14.4993 22 12 22C6.47715 22 2 17.5228 2 12C2 9.86386 2.66979 7.88416 3.8108 6.25944L7 12H4C4 16.4183 7.58172 20 12 20C14.1502 20 16.1022 19.1517 17.5398 17.7716L18.5374 19.5674Z" />
        </svg>
      );
    case 'search':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden="true">
          <path d="M18.031 16.6168L22.3137 20.8995L20.8995 22.3137L16.6168 18.031C15.0769 19.263 13.124 20 11 20C6.032 20 2 15.968 2 11C2 6.032 6.032 2 11 2C15.968 2 20 6.032 20 11C20 13.124 19.263 15.0769 18.031 16.6168ZM16.0247 15.8748C17.2475 14.6146 18 12.8956 18 11C18 7.1325 14.8675 4 11 4C7.1325 4 4 7.1325 4 11C4 14.8675 7.1325 18 11 18C12.8956 18 14.6146 17.2475 15.8748 16.0247L16.0247 15.8748Z" />
        </svg>
      );
    case 'chat-off':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden="true">
          <path d="M2.80777 1.39355L22.6068 21.1925L21.1925 22.6068L17.5846 18.9999L6.45455 19L2 22.5V4C2 3.82823 2.04329 3.66656 2.11959 3.52527L1.39355 2.80777L2.80777 1.39355ZM3.99998 5.41355V18.3853L5.76282 17H15.5846L3.99998 5.41355ZM21 3C21.5523 3 22 3.44772 22 4V17.7848L20 15.7848V5H9.21318L7.21418 3H21Z" />
        </svg>
      );
    case 'text-wrap':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden="true">
          <path d="M15 18H16.5C17.8807 18 19 16.8807 19 15.5C19 14.1193 17.8807 13 16.5 13H3V11H16.5C18.9853 11 21 13.0147 21 15.5C21 17.9853 18.9853 20 16.5 20H15V22L11 19L15 16V18ZM3 4H21V6H3V4ZM9 18V20H3V18H9Z" />
        </svg>
      );
    case 'external-link':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden="true">
          <path d="M10 6V8H5V19H16V14H18V20C18 20.5523 17.5523 21 17 21H4C3.44772 21 3 20.5523 3 20V7C3 6.44772 3.44772 6 4 6H10ZM21 3V11H19L18.9999 6.413L11.2071 14.2071L9.79289 12.7929L17.5849 5H13V3H21Z" />
        </svg>
      );
  }
};
