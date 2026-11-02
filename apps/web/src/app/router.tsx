import { createBrowserRouter, Navigate } from 'react-router';
import { ALL_ITEMS } from '@/layout/nav';
import { LoginPage } from '@/modules/auth/LoginPage';
import { HomePage } from '@/modules/home/HomePage';
import { PlaceholderPage } from '@/modules/placeholder/PlaceholderPage';
import { Authed, DrivePlaceholder, SystemOnly, WithMe } from './guards';
import { page } from './lazy';

// Every screen but sign-in and Home loads on first visit, so phones download only what they open.
const AccountPage = page(() => import('@/modules/account/AccountPage'), 'AccountPage');
const UiKitPage = page(() => import('@/modules/dev/UiKitPage'), 'UiKitPage');
const NotificationsPage = page(
  () => import('@/modules/notifications/NotificationsPage'),
  'NotificationsPage',
);
const ChecklistsPage = page(() => import('@/modules/checklists/ChecklistsPage'), 'ChecklistsPage');
const DelegationPage = page(() => import('@/modules/delegation/DelegationPage'), 'DelegationPage');
const WorkspacePage = page(() => import('@/modules/workspace/WorkspacePage'), 'WorkspacePage');
const ChannelsTab = page(() => import('@/modules/system/integration/ChannelsTab'), 'ChannelsTab');
const IntegrationTab = page(() => import('@/modules/system/integration/IntegrationTab'), 'IntegrationTab');
const RemindersTab = page(() => import('@/modules/system/integration/RemindersTab'), 'RemindersTab');
const RulesTab = page(() => import('@/modules/system/integration/RulesTab'), 'RulesTab');
const TelegramTab = page(() => import('@/modules/system/integration/TelegramTab'), 'TelegramTab');
const TemplatesTab = page(() => import('@/modules/system/integration/TemplatesTab'), 'TemplatesTab');
const WhatsAppTab = page(() => import('@/modules/system/integration/WhatsAppTab'), 'WhatsAppTab');
const AppearanceTab = page(() => import('@/modules/system/appearance/AppearanceTab'), 'AppearanceTab');
const Branches = page(() => import('@/modules/system/company/Branches'), 'Branches');
const CompanyProfile = page(() => import('@/modules/system/company/CompanyProfile'), 'CompanyProfile');
const CompanySetupTab = page(() => import('@/modules/system/company/CompanySetupTab'), 'CompanySetupTab');
const Designations = page(() => import('@/modules/system/company/Designations'), 'Designations');
const Shifts = page(() => import('@/modules/system/company/Shifts'), 'Shifts');
const DepartmentsTab = page(() => import('@/modules/system/departments/DepartmentsTab'), 'DepartmentsTab');
const OrgChartTab = page(() => import('@/modules/system/orgchart/OrgChartTab'), 'OrgChartTab');
const RolesTab = page(() => import('@/modules/system/roles/RolesTab'), 'RolesTab');
const SystemMasterLayout = page(() => import('@/modules/system/SystemMasterPage'), 'SystemMasterLayout');
const UsersTab = page(() => import('@/modules/system/users/UsersTab'), 'UsersTab');

const placeholderRoutes = ALL_ITEMS.filter((i) => i.phase > 0).map((i) => ({
  path: i.path,
  element: <PlaceholderPage />,
}));

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <Authed />,
    children: [
      { index: true, element: <WithMe render={(me) => <HomePage me={me} />} /> },
      { path: '/account', element: <WithMe render={(me) => <AccountPage me={me} />} /> },
      { path: '/notifications', element: <NotificationsPage /> },
      { path: '/delegation', element: <WithMe render={(me) => <DelegationPage me={me} />} /> },
      { path: '/checklists', element: <WithMe render={(me) => <ChecklistsPage me={me} />} /> },
      { path: '/workspace', element: <WithMe render={(me) => <WorkspacePage me={me} />} /> },
      ...placeholderRoutes.filter((r) => !r.path.startsWith('/system')),
      {
        element: <SystemOnly />,
        children: [
          { path: '/dev/ui', element: <WithMe render={(me) => <UiKitPage me={me} />} /> },
          {
            path: '/system',
            element: <SystemMasterLayout />,
            children: [
              { index: true, element: <Navigate to="/system/company" replace /> },
              {
                path: 'company',
                element: <CompanySetupTab />,
                children: [
                  { index: true, element: <CompanyProfile /> },
                  { path: 'shifts', element: <Shifts /> },
                  { path: 'branches', element: <Branches /> },
                  { path: 'designations', element: <Designations /> },
                ],
              },
              { path: 'departments', element: <DepartmentsTab /> },
              { path: 'users', element: <UsersTab /> },
              { path: 'roles', element: <RolesTab /> },
              { path: 'org-chart', element: <OrgChartTab /> },
              { path: 'appearance', element: <AppearanceTab /> },
              {
                path: 'integration',
                element: <IntegrationTab />,
                children: [
                  { index: true, element: <WhatsAppTab /> },
                  { path: 'templates', element: <TemplatesTab /> },
                  { path: 'telegram', element: <TelegramTab /> },
                  { path: 'channels', element: <ChannelsTab /> },
                  { path: 'rules', element: <RulesTab /> },
                  { path: 'reminders', element: <RemindersTab /> },
                  { path: 'drive', element: <DrivePlaceholder /> },
                ],
              },
              ...placeholderRoutes.filter((r) => r.path.startsWith('/system')),
            ],
          },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
