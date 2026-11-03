/**
 * "Build with AI" examples (CLAUDE.md §13): shown as chips on the screen, and the eval set every model
 * change is checked against. Plain words, the way an owner would say it; names are the demo company's.
 */
export const AI_FLOW_EXAMPLES = [
  {
    key: 'leadToOrder',
    minSteps: 10,
    maxSteps: 12,
    text: `Lead to order conversion for new customers. Neha Kapoor in marketing captures every new enquiry within an hour, with the company name, contact person, mobile, city, source and what they need. Arjun Rawat qualifies it within a day: is he talking to the person who decides, and is the need real? If the need is not confirmed we close the lead. If it is, Arjun meets them within 3 days. Ravi Kumar sends samples within 2 days of the meeting. Then we wait for the customer's trial order, up to a week. Rohit Mittal gives the proposal in person within 3 days and then negotiates the price, again about 3 days. Rajesh Goyal must approve the final price within 8 hours; if he rejects it, it goes back to negotiation. Rohit then gets the purchase order from the customer, usually within 3 days. Sunita Bansal hands it over to the order desk within 4 hours, and the system sends the customer a thank-you message.`,
  },
  {
    key: 'orderToDispatch',
    minSteps: 5,
    maxSteps: 12,
    text: `When a dealer places an order, the sales executive who took it enters the dealer, the items with quantity and rate, and the promised date. Production head checks within 4 hours if the slabs are in stock. If not, production plans them and finishes within 3 days. Quality checks the slabs and uploads a photo. Dispatch books a truck the same day, loads it and enters the vehicle number. The system makes the invoice, and accounts sends the e-way bill within 2 hours.`,
  },
  {
    key: 'purchaseRequest',
    minSteps: 4,
    maxSteps: 10,
    text: `Anyone can raise a purchase request with the item, quantity, why it is needed and by when. The HOD approves it within a day; if rejected it goes back to the person. Purchase gets three quotes within 2 days and picks one. Above ₹50,000 the owner must approve. Purchase places the order with the vendor and we wait for delivery. The store keeper checks the goods on arrival, enters the received quantity and uploads the bill photo. Accounts pays the vendor within 7 days.`,
  },
  {
    key: 'complaint',
    minSteps: 4,
    maxSteps: 10,
    text: `ग्राहक की शिकायत आने पर जो भी कॉल उठाए वह ग्राहक का नाम, ऑर्डर नंबर और समस्या लिखे। Quality team 1 दिन में साइट पर जाकर जांच करे और फोटो लगाए। अगर शिकायत सही है तो sales head 4 घंटे में replacement या credit note तय करे, dispatch 2 दिन में replacement भेजे। अगर शिकायत सही नहीं है तो ग्राहक को कारण बताकर बंद करें। आखिर में customer care ग्राहक को फोन करके पूछे कि वह संतुष्ट है या नहीं।`,
  },
  {
    key: 'joining',
    minSteps: 4,
    maxSteps: 12,
    text: `New employee joining: HR fills the name, mobile, department, designation and joining date as soon as the offer is accepted. Two days before joining, IT creates the email and MONO login and gives a laptop if needed. Admin keeps the ID card and uniform ready. On the joining day HR collects documents (Aadhaar, PAN, bank details) and uploads them. The HOD gives a one-day induction and assigns a buddy. After 7 days HR checks with the new person how it is going and closes the joining.`,
  },
] as const;
export type AiFlowExampleKey = (typeof AI_FLOW_EXAMPLES)[number]['key'];
