// TORA SKYLOUNGE demo blueprint. Real: name, address, 3rd + 4th floor, cocktails & bar food, ~₹1,000 for two,
// 4.8★ (380 Google reviews), valet, karaoke, dance floor, live sports screening, smoking area.
// Everything else (people, other branches, numbers) is IMAGINARY for the pitch.
export const DEMO_PASSWORD = 'Tora@2026';

export const COMPANY = {
  name: 'TORA SKYLOUNGE',
  legalName: 'Tora Hospitality Private Limited',
  city: 'Jaipur',
  state: 'Rajasthan',
  ownerName: 'Aditya Khandelwal',
  mobile: '+917000010001',
  email: 'hello@toraskylounge.demo',
  website: 'https://toraskylounge.demo',
};

export const CONTACTS = [
  ['Reservations', 'Riya Sharma', '+917000010021', 'reservations@toraskylounge.demo'],
  ['Events & parties', 'Simran Kaur', '+917000010040', 'events@toraskylounge.demo'],
  ['Accounts', 'Rakesh Mittal', '+917000010050', 'accounts@toraskylounge.demo'],
];

export const ENTITIES = [
  {
    key: 'own',
    name: 'Tora Hospitality Pvt Ltd',
    isDefault: true,
    state: 'Rajasthan',
    gstin14: '08AAKCT4821M1Z',
    details: {
      legalName: 'Tora Hospitality Private Limited',
      address: 'Floor No. 3rd & 4th, Janak Square, Plot No. 21 & 22, Kedia Palace Rd, Pravasi Nagar, Murlipura, Jaipur 302039',
      email: 'accounts@toraskylounge.demo',
      seriesCode: 'TSL',
      letterheadFooter: 'Subject to Jaipur jurisdiction',
      licences: [
        { name: 'FSSAI', number: '12226999000421', validTill: '2027-05-31' },
        { name: 'Bar licence (Excise)', number: 'RJ/EXC/JPR/2025/0187', validTill: '2027-03-31' },
        { name: 'Fire NOC', number: 'JMC/FIRE/2026/3391', validTill: '2027-01-15' },
      ],
    },
  },
  {
    key: 'franchise',
    name: 'Pink City Lounges LLP (franchise)',
    kind: 'FRANCHISE',
    state: 'Rajasthan',
    gstin14: '08AAPFP7310K1Z',
    details: {
      legalName: 'Pink City Lounges LLP',
      address: 'Gaurav Tower, Malviya Nagar, Jaipur 302017',
      seriesCode: 'TSLM',
      franchise: { agreementStart: '2026-10-01', agreementEnd: '2031-09-30', royaltyPercent: 6, minimumPaise: 75_000_00 },
    },
  },
];

// [key, name, code, type, entity, city, address, licences?]
export const BRANCHES = [
  {
    key: 'mur', name: 'TORA SKYLOUNGE – Murlipura', code: 'MUR', type: 'OUTLET', entity: 'own', isDefault: true,
    address: 'Floor No. 3rd & 4th, Janak Square, Plot No. 21 & 22, Kedia Palace Rd, Pravasi Nagar, Murlipura, Jaipur 302039',
    phone: '+917000010021', seriesCode: 'MUR',
    licences: [{ name: 'FSSAI', number: '12226999000421', validTill: '2027-05-31' }, { name: 'Bar licence (Excise)', number: 'RJ/EXC/JPR/2025/0187', validTill: '2027-03-31' }],
  },
  {
    key: 'ck', name: 'TORA Central Kitchen & Stores – VKI', code: 'CK', type: 'KITCHEN', entity: 'own',
    address: 'Road No. 14, Vishwakarma Industrial Area, Jaipur 302013', phone: '+917000010060', seriesCode: 'CK',
    licences: [{ name: 'FSSAI (central kitchen)', number: '12226999000588', validTill: '2027-08-31' }],
  },
  {
    key: 'vai', name: 'TORA Stays & Banquets – Vaishali Nagar', code: 'VAI', type: 'HOTEL', entity: 'own',
    address: 'Plot 7, Amrapali Marg, Vaishali Nagar, Jaipur 302021', phone: '+917000010070', seriesCode: 'VAI',
    licences: [{ name: 'Hotel registration (Tourism)', number: 'RTDC/HTL/2026/112', validTill: '2028-03-31' }],
  },
  {
    key: 'mnr', name: 'TORA SKYLOUNGE – Malviya Nagar (franchise)', code: 'MNR', type: 'OUTLET', entity: 'franchise',
    address: 'Rooftop, Gaurav Tower, Malviya Nagar, Jaipur 302017', phone: '+917000010080', seriesCode: 'MNR',
  },
];

// [branch, name, kind]
export const LOCATIONS = [
  ['mur', 'Murlipura kitchen store', 'STORE'],
  ['mur', 'Murlipura cold room', 'COLD_ROOM'],
  ['mur', 'Sky Bar (3rd floor)', 'BAR'],
  ['mur', 'Rooftop bar (4th floor)', 'BAR'],
  ['mur', 'Murlipura kitchen', 'KITCHEN'],
  ['ck', 'Central dry store', 'STORE'],
  ['ck', 'Central cold room', 'COLD_ROOM'],
  ['ck', 'Central liquor bond', 'STORE'],
  ['ck', 'Prep kitchen', 'KITCHEN'],
  ['vai', 'Hotel store', 'STORE'],
  ['vai', 'Banquet kitchen', 'KITCHEN'],
  ['vai', 'Café bar', 'BAR'],
  ['vai', 'Housekeeping linen store', 'OTHER'],
  ['mnr', 'Malviya Nagar store', 'STORE'],
  ['mnr', 'Malviya Nagar bar', 'BAR'],
];

// [name, parent?]
export const DEPARTMENTS = [
  ['Management'], ['Operations', 'Management'], ['EA', 'Management'],
  ['F&B Service'], ['Kitchen'], ['Bar'], ['Front Office'], ['Housekeeping'], ['Banquets & Events'],
  ['Purchase'], ['Stores'], ['Accounts'], ['HR & Admin'], ['Sales & Marketing'], ['Maintenance'], ['Security & Valet'],
];

export const DESIGNATIONS = [
  'Director', 'General Manager', 'Operations Manager', 'Executive Assistant', 'Restaurant Manager', 'Lounge Manager',
  'Captain', 'Steward', 'Hostess', 'Cashier', 'Executive Chef', 'Sous Chef', 'Chef de Partie', 'Tandoor Chef',
  'Chinese Chef', 'Commis', 'Kitchen Steward', 'Head Bartender', 'Bartender', 'Store Manager', 'Purchase Executive',
  'Central Kitchen Chef', 'Front Office Manager', 'Front Office Associate', 'Night Auditor',
  'Housekeeping Supervisor', 'Room Attendant', 'Banquet Manager', 'Banquet Sales Executive',
  'Marketing & Events Manager', 'Corporate Sales Executive', 'Accounts Manager', 'HR & Admin Manager',
  'Maintenance Head', 'Electrician', 'Valet Supervisor', 'Franchise Manager', 'DJ & Entertainment',
];

// [shift, start, end, weekdays]
export const SHIFTS = [
  ['Lounge – Day', '11:00', '19:00', [1, 2, 3, 4, 5, 6, 7]],
  ['Lounge – Night', '17:00', '01:00', [1, 2, 3, 4, 5, 6, 7]],
  ['Kitchen – Split', '10:00', '23:30', [1, 2, 3, 4, 5, 6, 7]],
  ['Hotel – Morning', '07:00', '15:00', [1, 2, 3, 4, 5, 6, 7]],
  ['Hotel – Evening', '15:00', '23:00', [1, 2, 3, 4, 5, 6, 7]],
  ['Hotel – Night', '23:00', '07:00', [1, 2, 3, 4, 5, 6, 7]],
  ['Office', '10:00', '19:00', [1, 2, 3, 4, 5, 6]],
];

// key, name, n(mobile suffix), dept, designation, role(key or role name), branch, shift, reportsTo key, hod?, alsoWorksIn[]
export const PEOPLE = [
  ['aditya', 'Aditya Khandelwal', '01', 'Management', 'Director', 'ADMIN', 'mur', 'Office', null, true],
  ['rohan', 'Rohan Mehta', '02', 'Operations', 'General Manager', 'General manager', 'mur', 'Office', 'aditya', true],
  ['sneha', 'Sneha Rathore', '03', 'Operations', 'Operations Manager', 'HOD', 'vai', 'Office', 'rohan', false],
  ['karan', 'Karan Shekhawat', '10', 'F&B Service', 'Restaurant Manager', 'F&B manager', 'mur', 'Lounge – Night', 'rohan', true],
  ['imran', 'Imran Qureshi', '11', 'F&B Service', 'Lounge Manager', 'F&B manager', 'mur', 'Lounge – Night', 'karan', false],
  ['deepak', 'Deepak Saini', '12', 'F&B Service', 'Captain', 'Steward / captain', 'mur', 'Lounge – Night', 'karan', false],
  ['pooja', 'Pooja Kanwar', '13', 'F&B Service', 'Captain', 'Steward / captain', 'mur', 'Lounge – Day', 'karan', false],
  ['rahul', 'Rahul Meena', '14', 'F&B Service', 'Steward', 'Steward / captain', 'mur', 'Lounge – Night', 'deepak', false],
  ['vishal', 'Vishal Kumawat', '15', 'F&B Service', 'Steward', 'Steward / captain', 'mur', 'Lounge – Night', 'deepak', false],
  ['ankit', 'Ankit Sharma', '16', 'F&B Service', 'Steward', 'Steward / captain', 'mur', 'Lounge – Day', 'pooja', false],
  ['sonu', 'Sonu Jangid', '17', 'F&B Service', 'Steward', 'Steward / captain', 'mur', 'Lounge – Day', 'pooja', false],
  ['riya', 'Riya Sharma', '21', 'F&B Service', 'Hostess', 'Reservations', 'mur', 'Lounge – Night', 'karan', false],
  ['manish', 'Manish Agarwal', '22', 'Accounts', 'Cashier', 'Cashier', 'mur', 'Lounge – Night', 'rakesh', false],
  ['harish', 'Chef Harish Bhatt', '30', 'Kitchen', 'Executive Chef', 'HOD', 'mur', 'Kitchen – Split', 'rohan', true],
  ['vinod', 'Vinod Rawat', '31', 'Kitchen', 'Sous Chef', 'Kitchen station', 'mur', 'Kitchen – Split', 'harish', false],
  ['mohan', 'Mohan Lal', '32', 'Kitchen', 'Tandoor Chef', 'Kitchen station', 'mur', 'Kitchen – Split', 'vinod', false],
  ['tenzin', 'Tenzin Dorje', '33', 'Kitchen', 'Chinese Chef', 'Kitchen station', 'mur', 'Kitchen – Split', 'vinod', false],
  ['suresh', 'Suresh Prajapat', '34', 'Kitchen', 'Chef de Partie', 'Kitchen station', 'mur', 'Kitchen – Split', 'vinod', false],
  ['lucky', 'Lucky Saini', '35', 'Kitchen', 'Commis', 'Kitchen station', 'mur', 'Kitchen – Split', 'suresh', false],
  ['ramesh', 'Ramesh Bairwa', '36', 'Kitchen', 'Kitchen Steward', 'MEMBER', 'mur', 'Kitchen – Split', 'vinod', false, false],
  ['aman', 'Aman Singh Rathore', '40', 'Bar', 'Head Bartender', 'Bartender', 'mur', 'Lounge – Night', 'karan', true],
  ['joel', "Joel D'Souza", '41', 'Bar', 'Bartender', 'Bartender', 'mur', 'Lounge – Night', 'aman', false],
  ['gopal', 'Gopal Choudhary', '50', 'Stores', 'Store Manager', 'HOD', 'ck', 'Office', 'rohan', true],
  ['nitin', 'Nitin Jain', '51', 'Purchase', 'Purchase Executive', 'HOD', 'ck', 'Office', 'rohan', true],
  ['prakash', 'Prakash Yadav', '52', 'Kitchen', 'Central Kitchen Chef', 'Kitchen station', 'ck', 'Kitchen – Split', 'harish', false],
  ['bablu', 'Bablu Gurjar', '53', 'Stores', 'Commis', 'MEMBER', 'ck', 'Office', 'gopal', false, false],
  ['neha', 'Neha Kapoor', '60', 'Front Office', 'Front Office Manager', 'Front office', 'vai', 'Hotel – Morning', 'sneha', true],
  ['arjun', 'Arjun Rawat', '61', 'Front Office', 'Front Office Associate', 'Front office', 'vai', 'Hotel – Evening', 'neha', false],
  ['sanjay', 'Sanjay Tak', '62', 'Front Office', 'Night Auditor', 'Night auditor', 'vai', 'Hotel – Night', 'neha', false],
  ['kavita', 'Kavita Devi', '63', 'Housekeeping', 'Housekeeping Supervisor', 'Housekeeping supervisor', 'vai', 'Hotel – Morning', 'sneha', true],
  ['sunita', 'Sunita Meghwal', '64', 'Housekeeping', 'Room Attendant', 'Housekeeping attendant', 'vai', 'Hotel – Morning', 'kavita', false],
  ['raju', 'Raju Prajapati', '65', 'Housekeeping', 'Room Attendant', 'Housekeeping attendant', 'vai', 'Hotel – Evening', 'kavita', false],
  ['vivek', 'Vivek Sharma', '66', 'Banquets & Events', 'Banquet Manager', 'Banquet manager', 'vai', 'Office', 'sneha', true],
  ['priya', 'Priya Bansal', '67', 'Banquets & Events', 'Banquet Sales Executive', 'MEMBER', 'vai', 'Office', 'vivek', false],
  ['simran', 'Simran Kaur', '40b', 'Sales & Marketing', 'Marketing & Events Manager', 'HOD', 'mur', 'Office', 'aditya', true],
  ['yash', 'Yash Gupta', '41b', 'Sales & Marketing', 'Corporate Sales Executive', 'MEMBER', 'mur', 'Office', 'simran', false],
  ['rakesh', 'Rakesh Mittal', '50b', 'Accounts', 'Accounts Manager', 'HOD', 'mur', 'Office', 'aditya', true],
  ['shalini', 'Shalini Joshi', '51b', 'HR & Admin', 'HR & Admin Manager', 'HOD', 'mur', 'Office', 'aditya', true],
  ['bhanwar', 'Bhanwar Singh', '70', 'Maintenance', 'Maintenance Head', 'HOD', 'mur', 'Office', 'rohan', true],
  ['pappu', 'Pappu Saini', '71', 'Maintenance', 'Electrician', 'MEMBER', 'mur', 'Lounge – Day', 'bhanwar', false, false],
  ['ramsingh', 'Ram Singh', '72', 'Security & Valet', 'Valet Supervisor', 'MEMBER', 'mur', 'Lounge – Night', 'rohan', true],
  ['dj', 'DJ Kabir', '73', 'Sales & Marketing', 'DJ & Entertainment', 'MEMBER', 'mur', 'Lounge – Night', 'simran', false, false],
  ['kunal', 'Kunal Bhatia', '80', 'Operations', 'Franchise Manager', 'F&B manager', 'mnr', 'Lounge – Night', 'rohan', false],
];

/** Mobile from the suffix: +91 70000 1xxxx, letters map to 5-9 so every person gets a distinct number. */
export const mobileOf = (suffix) => {
  const digits = suffix.replace('b', '9');
  return `+9170000${digits.padStart(5, '1')}`.slice(0, 13);
};
export const emailOf = (name) =>
  name.toLowerCase().replace(/^chef |^dj /, '').replace(/[^a-z ]/g, '').trim().split(/\s+/).join('.') + '@toraskylounge.demo';
