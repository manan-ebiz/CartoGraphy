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
      <Link to="/" className="mark" onClick={handleHomeClick}>
        carto<span>graph</span>
      </Link>
      <span className="coords">TURN YOUR DATA INTO MAP</span>
    </header>
  );
}

function Shell() {
  const { pathname } = useLocation();
  const wide = pathname.includes('/results') || pathname.includes('/jobs/');

  return (
    <div className={`shell${wide ? ' shell-wide' : ''}`}>
      <Masthead />
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
