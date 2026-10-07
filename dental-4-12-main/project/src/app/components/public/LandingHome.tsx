import { HeroArt } from './HeroArt';
import { PrimaryLink, SecondaryLink, Tag } from './PublicLayout';

// Home is one screen, like the RAMHIS landing page: the pitch and a picture.
// Everything else lives on About Floral.
export const LandingHome = () => (
  <div className="mx-auto grid w-full max-w-6xl flex-1 content-center items-center gap-10 px-5 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
    <div>
      <Tag>Floral: Dental Health Record Management System</Tag>
      <h1 className="mt-4 text-balance text-4xl font-extrabold leading-[1.02] tracking-tight sm:text-6xl">
        Healthy smiles <span className="block text-sky-300">for every school year.</span>
      </h1>
      <p className="mt-4 max-w-[50ch] text-base text-blue-100/85 sm:text-lg">
        Floral keeps appointments, student records, dental charts, treatments, routine preventive care monitoring and reports for school dental clinics in Taguig City. It works offline in the field and syncs when the connection returns.
      </p>
      <div className="mt-7 flex flex-wrap gap-2.5"><PrimaryLink to="/login">Sign in</PrimaryLink><SecondaryLink to="/about">See how it works</SecondaryLink></div>
    </div>
    <div className="hidden md:block"><HeroArt /></div>
  </div>
);
