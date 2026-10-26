import type { Ref } from 'react';
import { CalendarDays, Clock3, FileUp, LayoutTemplate, LogOut, MoreHorizontal, Settings2 } from 'lucide-react';
import { useAuthentication } from '../AuthBoundary';
import type { WorkspacePage } from '../hooks/useWorkspaceNavigation';
import { Popover } from './Popover';
import { useMessages } from '../i18n';
import { shellMessages } from '../locales/shell';
import { Brand } from './Brand';

type AppHeaderProps = {
  page: WorkspacePage;
  onNavigate: (page: WorkspacePage) => void;
  onOpenDialog: (kind: 'import' | 'settings') => void;
  reportsRef: Ref<HTMLAnchorElement>;
};

export function AppHeader({ page, onNavigate, onOpenDialog, reportsRef }: AppHeaderProps) {
  const { t } = useMessages(shellMessages);
  const { logout } = useAuthentication();
  return (
    <header className="site-header">
      <div className="site-inner header-inner">
        <a className="brand" href="#/kalender" aria-label={t('brandCalendar')} onClick={event => {
          event.preventDefault();
          onNavigate('calendar');
        }}><Brand /></a>
        <nav className="main-navigation" aria-label={t('navigation')}>
          <a href="#/kalender" aria-current={page === 'calendar' ? 'page' : undefined} onClick={event => {
            event.preventDefault();
            onNavigate('calendar');
          }}><CalendarDays size={17} />{t('calendar')}</a>
          <a ref={reportsRef} href="#/zeitkonto" aria-current={page === 'reports' ? 'page' : undefined} onClick={event => {
            event.preventDefault();
            onNavigate('reports');
          }}><Clock3 size={17} />{t('account')}</a>
          <a href="#/vorlagen" aria-current={page === 'templates' ? 'page' : undefined} onClick={event => {
            event.preventDefault();
            onNavigate('templates');
          }}><LayoutTemplate size={17} />{t('templates')}</a>
        </nav>
        <div className="header-tools">
          <span className="local-badge"><span aria-hidden="true" /> {t('localStorage')}</span>
          <div className="desktop-header-actions">
            <button className="button quiet" onClick={() => onOpenDialog('import')}><FileUp size={16} />{t('import')}</button>
            <button className="icon-button" aria-label={t('settings')} title={t('settings')} onClick={() => onOpenDialog('settings')}><Settings2 size={18} /></button>
            {logout && <button className="icon-button" aria-label={t('signOut')} title={t('signOut')} onClick={logout}><LogOut size={18} /></button>}
          </div>
          <div className="mobile-header-actions">
            <Popover label={t('appActions')} trigger={<MoreHorizontal size={20} />} className="icon-button" menu>
              <button role="menuitem" onClick={() => onOpenDialog('import')}><FileUp size={16} />{t('import')}</button>
              <button role="menuitem" onClick={() => onOpenDialog('settings')}><Settings2 size={16} />{t('settings')}</button>
              {logout && <button role="menuitem" onClick={logout}><LogOut size={16} />{t('signOut')}</button>}
            </Popover>
          </div>
        </div>
      </div>
    </header>
  );
}
