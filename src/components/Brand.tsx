import owl from '../assets/overdue-owl.png';

/** Shared visual identity; the surrounding link or header supplies its semantics. */
export function Brand() {
  return <><img className="brand-mark" src={owl} width={34} height={34} alt="" aria-hidden="true" /><span>I'm Overdue</span></>;
}
