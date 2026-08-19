type BrandProps = {
  ariaLabel?: string;
};

export function Brand({ ariaLabel }: BrandProps) {
  return (
    <a className="brand" href="/" {...(ariaLabel ? { "aria-label": ariaLabel } : {})}>
      <span className="brand-mark"><span /></span>
      GoLive
    </a>
  );
}