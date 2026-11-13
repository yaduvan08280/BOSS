// Who and where: every name here is made up for the demonstration (no real staff list was found).

// The Murlipura venue is real (address from its public listing). The others are examples of how further
// branches, a base kitchen and a hotel would sit in MONO — rename or remove them to match the real plan.
export const BRANCHES = [
  { key: 'ho', name: 'Tora Hospitality — Office', code: 'HO', type: 'OFFICE', city: 'Jaipur', address: 'Janak Square, Kedia Palace Road, Murlipura, Jaipur 302039' },
  { key: 'sky', name: 'Tora Skylounge — Murlipura (Janak Square)', code: 'SKY', type: 'OUTLET', city: 'Jaipur', address: '3rd & 4th Floor, Janak Square, Plot 21 & 22, Kedia Palace Road, Pravasi Nagar, Murlipura, Jaipur 302039' },
  { key: 'vsn', name: 'Tora Skylounge — Vaishali Nagar (planned)', code: 'VSN', type: 'OUTLET', city: 'Jaipur', address: 'Vaishali Nagar, Jaipur (example of a second outlet)' },
  { key: 'ck', name: 'Tora Base Kitchen & Store (planned)', code: 'CK', type: 'KITCHEN', city: 'Jaipur', address: 'Vishwakarma Industrial Area, Jaipur (example)' },
  { key: 'sty', name: 'Tora Suites & Banquets (planned)', code: 'STY', type: 'HOTEL', city: 'Jaipur', address: 'Kedia Palace Road, Jaipur (example of a hotel with a banquet hall)' },
];

export const LOCATIONS = [
  ['ck', 'Central store', 'STORE'],
  ['ck', 'Central kitchen', 'KITCHEN'],
  ['ck', 'Cold room', 'COLD_ROOM'],
  ['sky', 'Skylounge kitchen', 'KITCHEN'],
  ['sky', 'Skylounge bar', 'BAR'],
  ['vsn', 'Vaishali kitchen', 'KITCHEN'],
  ['vsn', 'Vaishali bar', 'BAR'],
  ['sty', 'Suites pantry', 'KITCHEN'],
  ['sty', 'Housekeeping store', 'STORE'],
];

export const DEPARTMENTS = [
  'Management', 'Operations', 'Kitchen', 'Bar', 'Service', 'Front Office', 'Housekeeping',
  'Banquets & Events', 'Sales & Marketing', 'Purchase & Stores', 'Accounts', 'HR & Admin', 'Maintenance',
];

export const DESIGNATIONS = [
  'Managing Director', 'General Manager', 'EA to MD', 'Outlet Manager', 'Executive Chef', 'Sous Chef',
  'Commis Chef', 'Tandoor Chef', 'Bar Manager', 'Bartender', 'Captain', 'Steward', 'Host', 'Cashier',
  'Front Office Manager', 'Front Desk Executive', 'Housekeeping Supervisor', 'Room Attendant',
  'Banquet Manager', 'Sales Manager', 'Sales Executive', 'Marketing Executive', 'Purchase Manager',
  'Store Keeper', 'Accountant', 'HR Manager', 'Maintenance Engineer',
];

// name, start, end, weekdays (1 = Monday)
export const SHIFTS = [
  ['Office', '10:00', '19:00', [1, 2, 3, 4, 5, 6]],
  ['Kitchen prep', '08:00', '17:00', [1, 2, 3, 4, 5, 6, 7]],
  ['Lunch service', '11:00', '20:00', [1, 2, 3, 4, 5, 6, 7]],
  ['Dinner service', '16:00', '01:00', [1, 2, 3, 4, 5, 6, 7]],
  ['Hotel morning', '07:00', '15:00', [1, 2, 3, 4, 5, 6, 7]],
  ['Hotel evening', '15:00', '23:00', [1, 2, 3, 4, 5, 6, 7]],
  ['Hotel night', '23:00', '07:00', [1, 2, 3, 4, 5, 6, 7]],
];

// key, name, role, designation, department, branch, shift, reports to (key), salary ₹/month
export const PEOPLE = [
  ['arjun', 'Arjun Rathore', 'ADMIN', 'General Manager', 'Management', 'ho', 'Office', null, 140000],
  ['meera', 'Meera Bhatt', 'EA', 'EA to MD', 'Management', 'ho', 'Office', null, 45000],
  ['kavita', 'Kavita Joshi', 'HOD', 'HR Manager', 'HR & Admin', 'ho', 'Office', 'arjun', 60000],
  ['suresh', 'Suresh Agarwal', 'HOD', 'Accountant', 'Accounts', 'ho', 'Office', 'arjun', 55000],
  ['rohit', 'Rohit Saxena', 'HOD', 'Sales Manager', 'Sales & Marketing', 'ho', 'Office', 'arjun', 70000],
  ['ananya', 'Ananya Kapoor', 'MEMBER', 'Sales Executive', 'Sales & Marketing', 'ho', 'Office', 'rohit', 32000],
  ['tanvi', 'Tanvi Mehra', 'MEMBER', 'Marketing Executive', 'Sales & Marketing', 'ho', 'Office', 'rohit', 30000],
  ['girish', 'Girish Mathur', 'HOD', 'Purchase Manager', 'Purchase & Stores', 'ck', 'Kitchen prep', 'arjun', 50000],
  ['ramesh', 'Ramesh Prajapat', 'MEMBER', 'Store Keeper', 'Purchase & Stores', 'ck', 'Kitchen prep', 'girish', 24000],
  ['sanjay', 'Sanjay Bhargava', 'HOD', 'Executive Chef', 'Kitchen', 'ck', 'Kitchen prep', 'arjun', 110000],
  ['mohit', 'Mohit Sain', 'MEMBER', 'Commis Chef', 'Kitchen', 'ck', 'Kitchen prep', 'sanjay', 22000],
  ['vikram', 'Vikram Shekhawat', 'HOD', 'Outlet Manager', 'Operations', 'sky', 'Dinner service', 'arjun', 75000],
  ['imran', 'Imran Qureshi', 'SUPERVISOR', 'Sous Chef', 'Kitchen', 'sky', 'Dinner service', 'sanjay', 48000],
  ['deepak', 'Deepak Meena', 'MEMBER', 'Tandoor Chef', 'Kitchen', 'sky', 'Dinner service', 'imran', 30000],
  ['rahul', 'Rahul Verma', 'SUPERVISOR', 'Bar Manager', 'Bar', 'sky', 'Dinner service', 'vikram', 45000],
  ['aditya', 'Aditya Nair', 'MEMBER', 'Bartender', 'Bar', 'sky', 'Dinner service', 'rahul', 26000],
  ['pooja', 'Pooja Sharma', 'MEMBER', 'Host', 'Service', 'sky', 'Dinner service', 'vikram', 24000],
  ['manoj', 'Manoj Kumar', 'SUPERVISOR', 'Captain', 'Service', 'sky', 'Dinner service', 'vikram', 28000],
  ['sunil', 'Sunil Yadav', 'MEMBER', 'Steward', 'Service', 'sky', 'Dinner service', 'manoj', 18000],
  ['neha', 'Neha Gupta', 'MEMBER', 'Cashier', 'Accounts', 'sky', 'Dinner service', 'vikram', 22000],
  ['priya', 'Priya Chauhan', 'HOD', 'Outlet Manager', 'Operations', 'vsn', 'Dinner service', 'arjun', 68000],
  ['farhan', 'Farhan Ali', 'SUPERVISOR', 'Sous Chef', 'Kitchen', 'vsn', 'Dinner service', 'sanjay', 45000],
  ['karan', 'Karan Singh', 'SUPERVISOR', 'Captain', 'Service', 'vsn', 'Dinner service', 'priya', 27000],
  ['ritu', 'Ritu Saini', 'MEMBER', 'Steward', 'Service', 'vsn', 'Dinner service', 'karan', 18000],
  ['lokesh', 'Lokesh Jangid', 'MEMBER', 'Bartender', 'Bar', 'vsn', 'Dinner service', 'priya', 25000],
  ['shalini', 'Shalini Rao', 'HOD', 'Front Office Manager', 'Front Office', 'sty', 'Hotel morning', 'arjun', 62000],
  ['aman', 'Aman Khandelwal', 'MEMBER', 'Front Desk Executive', 'Front Office', 'sty', 'Hotel evening', 'shalini', 24000],
  ['lakshmi', 'Lakshmi Devi', 'SUPERVISOR', 'Housekeeping Supervisor', 'Housekeeping', 'sty', 'Hotel morning', 'shalini', 26000],
  ['geeta', 'Geeta Kumari', 'MEMBER', 'Room Attendant', 'Housekeeping', 'sty', 'Hotel morning', 'lakshmi', 16000],
  ['dinesh', 'Dinesh Solanki', 'HOD', 'Banquet Manager', 'Banquets & Events', 'sty', 'Lunch service', 'arjun', 58000],
  ['harish', 'Harish Tak', 'MEMBER', 'Maintenance Engineer', 'Maintenance', 'sty', 'Hotel morning', 'shalini', 28000],
];

// department → head (key)
export const HEADS = {
  Management: 'arjun', Operations: 'vikram', Kitchen: 'sanjay', Bar: 'rahul', Service: 'manoj',
  'Front Office': 'shalini', Housekeeping: 'lakshmi', 'Banquets & Events': 'dinesh',
  'Sales & Marketing': 'rohit', 'Purchase & Stores': 'girish', Accounts: 'suresh', 'HR & Admin': 'kavita',
  Maintenance: 'harish',
};
// branch → managers, HR
export const MANAGERS = { sky: ['vikram'], vsn: ['priya'], ck: ['sanjay'], sty: ['shalini'], ho: ['arjun'] };
