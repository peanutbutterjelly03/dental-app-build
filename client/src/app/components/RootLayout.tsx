import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { Root } from './Root';

export const RootLayout = () => {
  const { user, loading, schoolChoiceMade } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate('/login');
    } else if (!schoolChoiceMade) {
      navigate('/select-school');
    }
  }, [user, loading, schoolChoiceMade, navigate]);

  // Keyed on the CHOICE, not the value: "all schools" is a legitimate
  // selection that leaves selectedSchool null, and gating on null would bounce
  // the user straight back to the picker.
  if (loading || !user || !schoolChoiceMade) return null;

  return <Root />;
};
