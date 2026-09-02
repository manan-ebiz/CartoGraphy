import { Routes, Route, Link, useNavigate, useLocation } from 'react-router-dom';
import HomePage from './components/HomePage.jsx';
import ProgressPage from './components/ProgressPage.jsx';
import ResultsPage from './components/ResultsPage.jsx';
import { CrawlGuardProvider, useCrawlGuard } from './crawlGuard.jsx';

function Masthead() {
  const navigate = useNavigate();
  const { requestLeave } = useCrawlGuard();

  async function handleHomeClick(e) {
    e.preventDefault();
    const allowed = await requestLeave();
    if (allowed) navigate('/');
  }

  return (
    <header className="masthead">
      <Link to="/" className="brand-lockup" onClick={handleHomeClick}>
        <img src="/logo.png" alt="CARTOGRAPH — Turn data into maps" className="brand-logo-bar" />
      </Link>
    </header>
  );
}

function Shell() {
  const { pathname } = useLocation();
  const wide = pathname.includes('/results');
  const home = pathname === '/';

  return (
    <div className={`shell${wide ? ' shell-wide' : ''}${home ? ' shell-home' : ''}`}>
      {!home && <Masthead />}
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/jobs/:jobId" element={<ProgressPage />} />
        <Route path="/jobs/:jobId/results" element={<ResultsPage />} />
      </Routes>
    </div>
  );
}

export default function App() {
  return (
    <CrawlGuardProvider>
      <Shell />
    </CrawlGuardProvider>
  );
}
