import { Frame, PrimaryLink, SecondaryLink, Tag } from './PublicLayout';

// Home is one screen, like the RAMHIS landing page: the pitch and a real screen of
// the app. Everything else lives on About Floral.
export const LandingHome = () => (
  <div className="mx-auto grid min-h-[calc(100vh-6rem)] w-full max-w-6xl items-center gap-10 px-5 pb-14 pt-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
    <div>
      <Tag>About Floral</Tag>
      <h1 className="mt-4 text-balance text-4xl font-extrabold leading-[1.02] tracking-tight sm:text-6xl">
        Healthy smiles <span className="block text-sky-300">for every school year.</span>
      </h1>
      <p className="mt-4 max-w-[46ch] text-base text-blue-100/85 sm:text-lg">
        Floral keeps dental charts, appointments and two-visit RPC monitoring for three Tanyag schools. It works offline in the field and syncs when the connection returns.
      </p>
      <div className="mt-7 flex flex-wrap gap-2.5"><PrimaryLink to="/login">Sign in</PrimaryLink><SecondaryLink to="/about">See how it works</SecondaryLink></div>
    </div>
    <Frame url="floral / dashboard" chip={['Clinic summary', 'Real screen from Floral']}>
      <img src="/landing/dashboard.jpg" alt="Floral clinic summary: patients enrolled, appointments today, high-risk patients and RPC completion" className="block h-auto w-full" />
    </Frame>
  </div>
);
