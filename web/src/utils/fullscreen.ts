type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type FullscreenDocument = Document & {
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
};

export function requestFullscreen(element: HTMLElement): Promise<void> {
  const candidate = element as FullscreenElement;

  if (candidate.requestFullscreen) {
    return candidate.requestFullscreen();
  }

  if (candidate.webkitRequestFullscreen) {
    return Promise.resolve(candidate.webkitRequestFullscreen());
  }

  return Promise.reject(new Error("Fullscreen is not supported."));
}

export function exitFullscreen(): Promise<void> {
  const candidate = document as FullscreenDocument;

  if (candidate.exitFullscreen) {
    return candidate.exitFullscreen();
  }

  if (candidate.webkitExitFullscreen) {
    return Promise.resolve(candidate.webkitExitFullscreen());
  }

  return Promise.resolve();
}

export function getFullscreenElement(): Element | null {
  const candidate = document as FullscreenDocument;

  return document.fullscreenElement ?? candidate.webkitFullscreenElement ?? null;
}