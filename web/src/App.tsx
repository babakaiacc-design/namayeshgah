import { NavLink, Route, Routes } from 'react-router-dom';

import { Icon, type IconName } from './components/Icon';
import { useOnline } from './lib/useOnline';
import { CalendarPage } from './features/CalendarPage';
import { DetailPage } from './features/DetailPage';
import { FavoritesPage } from './features/FavoritesPage';
import { HomePage } from './features/HomePage';
import { ProfilePage } from './features/ProfilePage';
import { SearchPage } from './features/SearchPage';

const NAV: Array<{ to: string; label: string; icon: IconName }> = [
  { to: '/', label: 'خانه', icon: 'home' },
  { to: '/calendar', label: 'تقویم', icon: 'calendar' },
  { to: '/search', label: 'جستجو', icon: 'search' },
  { to: '/favorites', label: 'ذخیره‌ها', icon: 'heart' },
  { to: '/profile', label: 'پروفایل', icon: 'user' },
];

export function App() {
  const online = useOnline();

  return (
    <div className="app">
      <main className="app__main">
        {!online && (
          <p className="offline-banner">
            آفلاین هستید — آخرین اطلاعات ذخیره‌شده نمایش داده می‌شود
          </p>
        )}

        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/favorites" element={<FavoritesPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/exhibition/:idOrSlug" element={<DetailPage />} />
        </Routes>
      </main>

      <nav className="nav" aria-label="ناوبری اصلی">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className="nav__item"
            aria-label={item.label}
          >
            <Icon name={item.icon} size="lg" />
            <span className="nav__label">{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
