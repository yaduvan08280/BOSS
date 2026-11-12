import { Suspense } from 'react';
import { createBrowserRouter, Navigate } from 'react-router';
import { ALL_ITEMS } from '@/layout/nav';
import { LoginPage } from '@/modules/auth/LoginPage';
import { HomePage } from '@/modules/home/HomePage';
import { PlaceholderPage } from '@/modules/placeholder/PlaceholderPage';
import { Authed, SystemOnly, WithMe } from './guards';
import { RouteError } from './RouteError';
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
const SlipsPage = page(() => import('@/modules/slips/SlipsPage'), 'SlipsPage');
const TicketsPage = page(() => import('@/modules/tickets/TicketsPage'), 'TicketsPage');
const EaPage = page(() => import('@/modules/ea/EaPage'), 'EaPage');
const MisPage = page(() => import('@/modules/mis/MisPage'), 'MisPage');
const EnginePage = page(() => import('@/modules/system/engine/EnginePage'), 'EnginePage');
const BuilderPage = page(() => import('@/modules/fms/BuilderPage'), 'BuilderPage');
const FlowEditorPage = page(() => import('@/modules/fms/FlowEditor'), 'FlowEditorPage');
const LiveFmsPage = page(() => import('@/modules/fms/LiveFmsPage'), 'LiveFmsPage');
const MyStepsPage = page(() => import('@/modules/fms/MyStepsPage'), 'MyStepsPage');
const DocumentsPage = page(() => import('@/modules/fms/DocumentsPage'), 'DocumentsPage');
const PublicFormPage = page(() => import('@/modules/fms/PublicFormPage'), 'PublicFormPage');
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
const BranchesTab = page(() => import('@/modules/system/branches/BranchesTab'), 'BranchesTab');
const OrgChartTab = page(() => import('@/modules/system/orgchart/OrgChartTab'), 'OrgChartTab');
const RolesTab = page(() => import('@/modules/system/roles/RolesTab'), 'RolesTab');
const SystemMasterLayout = page(() => import('@/modules/system/SystemMasterPage'), 'SystemMasterLayout');
const DriveTab = page(() => import('@/modules/system/integration/DriveTab'), 'DriveTab');
const SupportPage = page(() => import('@/modules/support/SupportPage'), 'SupportPage');
const GuidePage = page(() => import('@/modules/support/SupportPage'), 'GuidePage');
const ErrorsTab = page(() => import('@/modules/system/errors/ErrorsTab'), 'ErrorsTab');
const ApiKeysTab = page(() => import('@/modules/system/apikeys/ApiKeysTab'), 'ApiKeysTab');
const UsersTab = page(() => import('@/modules/system/users/UsersTab'), 'UsersTab');
const AiTab = page(() => import('@/modules/ai/AiTab'), 'AiTab');
const BusinessDetailsPage = page(() => import('@/modules/ai/BusinessDetailsPage'), 'BusinessDetailsPage');
const BuildWithAiPage = page(() => import('@/modules/ai/BuildWithAiPage'), 'BuildWithAiPage');
const MastersPage = page(() => import('@/modules/ai/MastersPage'), 'MastersPage');
const AttendancePage = page(() => import('@/modules/hr/AttendancePage'), 'AttendancePage');
const LeavePage = page(() => import('@/modules/hr/LeavePage'), 'LeavePage');
const CoverBoardPage = page(() => import('@/modules/hr/CoverBoardPage'), 'CoverBoardPage');
const PayrollPage = page(() => import('@/modules/hr/PayrollPage'), 'PayrollPage');
const StockPage = page(() => import('@/modules/ims/StockPage'), 'StockPage');
const PurchasePage = page(() => import('@/modules/ims/PurchasePage'), 'PurchasePage');
const MaxReviewPage = page(() => import('@/modules/ims/MaxReviewPage'), 'MaxReviewPage');
const AuditPage = page(() => import('@/modules/ims/AuditPage'), 'AuditPage');
const InventorySetup = page(() => import('@/modules/ims/InventorySetup'), 'InventorySetup');
const CrmDashboard = page(() => import('@/modules/crm/DashboardPage'), 'DashboardPage');
const CrmSetup = page(() => import('@/modules/crm/SetupPage'), 'SetupPage');
const CrmCustomers = page(() => import('@/modules/crm/CustomersPage'), 'CustomersPage');
const CrmScot = page(() => import('@/modules/crm/ScotPage'), 'ScotPage');
const CrmCalls = page(() => import('@/modules/crm/CallsPage'), 'CallsPage');
const CrmOrders = page(() => import('@/modules/crm/OrdersPage'), 'OrdersPage');
const CrmCollections = page(() => import('@/modules/crm/CollectionsPage'), 'CollectionsPage');
const CrmNbd = page(() => import('@/modules/crm/NbdPage'), 'NbdPage');
const CrmMeca = page(() => import('@/modules/crm/MecaPage'), 'MecaPage');
const CrmFieldsTab = page(() => import('@/modules/crm/CrmFieldsTab'), 'CrmFieldsTab');
const MasterRowsPage = page(() => import('@/modules/masters/MasterRowsPage'), 'MasterRowsPage');
const LibraryPage = page(() => import('@/modules/masters/LibraryPage'), 'LibraryPage');
const RecordTypesPage = page(() => import('@/modules/records/RecordTypesPage'), 'RecordTypesPage');
const TypeEditorPage = page(() => import('@/modules/records/TypeEditorPage'), 'TypeEditorPage');
const RecordListPage = page(() => import('@/modules/records/RecordListPage'), 'RecordListPage');
const ListsPage = page(() => import('@/modules/lists/ListsPage'), 'ListsPage');
const ReportsPage = page(() => import('@/modules/reports/ReportsPage'), 'ReportsPage');
const ReportBuilderPage = page(() => import('@/modules/reports/ReportBuilderPage'), 'ReportBuilderPage');
const RulesWizard = page(() => import('@/modules/hr/RulesWizard'), 'RulesWizard');

const placeholderRoutes = ALL_ITEMS.filter((i) => i.phase > 0).map((i) => ({
  path: i.path,
  element: <PlaceholderPage />,
}));

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  // Public "share a form" link: no sign-in.
  {
    path: '/f/:token',
    element: (
      <Suspense fallback={null}>
        <PublicFormPage />
      </Suspense>
    ),
  },
  {
    element: <Authed />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <WithMe render={(me) => <HomePage me={me} />} /> },
      { path: '/account', element: <WithMe render={(me) => <AccountPage me={me} />} /> },
      { path: '/notifications', element: <NotificationsPage /> },
      { path: '/support', element: <SupportPage /> },
      { path: '/support/guide/:slug', element: <GuidePage /> },
      { path: '/delegation', element: <WithMe render={(me) => <DelegationPage me={me} />} /> },
      { path: '/checklists', element: <WithMe render={(me) => <ChecklistsPage me={me} />} /> },
      { path: '/workspace', element: <WithMe render={(me) => <WorkspacePage me={me} />} /> },
      { path: '/help-slips', element: <WithMe render={(me) => <SlipsPage me={me} />} /> },
      { path: '/help-tickets', element: <WithMe render={(me) => <TicketsPage me={me} />} /> },
      { path: '/ea', element: <WithMe render={(me) => <EaPage me={me} />} /> },
      { path: '/mis', element: <WithMe render={(me) => <MisPage me={me} />} /> },
      { path: '/fms/builder', element: <WithMe render={(me) => <BuilderPage me={me} />} /> },
      { path: '/fms/builder/ai', element: <WithMe render={(me) => <BuildWithAiPage me={me} />} /> },
      { path: '/fms/builder/:id', element: <WithMe render={(me) => <FlowEditorPage me={me} />} /> },
      { path: '/masters', element: <WithMe render={(me) => <MastersPage me={me} />} /> },
      { path: '/hr/attendance', element: <WithMe render={(me) => <AttendancePage me={me} />} /> },
      { path: '/hr/leave', element: <WithMe render={(me) => <LeavePage me={me} />} /> },
      { path: '/hr/cover', element: <WithMe render={(me) => <CoverBoardPage me={me} />} /> },
      { path: '/hr/payroll', element: <WithMe render={(me) => <PayrollPage me={me} />} /> },
      { path: '/ims/stock', element: <WithMe render={(me) => <StockPage me={me} />} /> },
      { path: '/ims/purchase', element: <WithMe render={(me) => <PurchasePage me={me} />} /> },
      { path: '/ims/max-review', element: <WithMe render={(me) => <MaxReviewPage me={me} />} /> },
      { path: '/ims/audit', element: <WithMe render={(me) => <AuditPage me={me} />} /> },
      { path: '/crm', element: <WithMe render={(me) => <CrmDashboard me={me} />} /> },
      { path: '/crm/setup', element: <WithMe render={(me) => <CrmSetup me={me} />} /> },
      { path: '/crm/customers', element: <WithMe render={(me) => <CrmCustomers me={me} />} /> },
      { path: '/crm/scot', element: <WithMe render={(me) => <CrmScot me={me} />} /> },
      { path: '/crm/calls', element: <WithMe render={(me) => <CrmCalls me={me} />} /> },
      { path: '/crm/orders', element: <WithMe render={(me) => <CrmOrders me={me} />} /> },
      { path: '/crm/collections', element: <WithMe render={(me) => <CrmCollections me={me} />} /> },
      { path: '/crm/nbd', element: <WithMe render={(me) => <CrmNbd me={me} />} /> },
      { path: '/crm/meca', element: <WithMe render={(me) => <CrmMeca me={me} />} /> },
      { path: '/masters/build', element: <WithMe render={(me) => <MastersPage me={me} />} /> },
      { path: '/masters/library', element: <WithMe render={(me) => <LibraryPage me={me} />} /> },
      { path: '/masters/lists', element: <WithMe render={(me) => <ListsPage me={me} />} /> },
      { path: '/masters/:id', element: <WithMe render={(me) => <MasterRowsPage me={me} />} /> },
      { path: '/records/types', element: <WithMe render={(me) => <RecordTypesPage me={me} />} /> },
      { path: '/records/types/new', element: <WithMe render={(me) => <TypeEditorPage me={me} />} /> },
      { path: '/records/types/:id', element: <WithMe render={(me) => <TypeEditorPage me={me} />} /> },
      { path: '/records/:typeId', element: <WithMe render={(me) => <RecordListPage me={me} />} /> },
      { path: '/reports', element: <ReportsPage /> },
      { path: '/reports/new', element: <WithMe render={(me) => <ReportBuilderPage me={me} />} /> },
      { path: '/reports/:id', element: <WithMe render={(me) => <ReportBuilderPage me={me} />} /> },
      { path: '/fms/live', element: <WithMe render={(me) => <LiveFmsPage me={me} />} /> },
      { path: '/fms/my-steps', element: <WithMe render={(me) => <MyStepsPage me={me} />} /> },
      { path: '/documents', element: <WithMe render={(me) => <DocumentsPage me={me} />} /> },
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
              { path: 'branches', element: <BranchesTab /> },
              { path: 'appearance', element: <AppearanceTab /> },
              { path: 'business-details', element: <BusinessDetailsPage /> },
              { path: 'hr-rules', element: <RulesWizard /> },
              { path: 'inventory', element: <InventorySetup /> },
              { path: 'crm', element: <CrmFieldsTab /> },
              { path: 'engine', element: <EnginePage /> },
              { path: 'api-keys', element: <ApiKeysTab /> },
              { path: 'errors', element: <ErrorsTab /> },
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
                  { path: 'ai', element: <AiTab /> },
                  { path: 'drive', element: <DriveTab /> },
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
