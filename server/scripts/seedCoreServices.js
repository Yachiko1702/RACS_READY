/*
 * Seed CoreService and RepairService collections with richer demo data.
 * Usage: NODE_ENV=development node server/scripts/seedCoreServices.js
 */
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const CoreService = require('../models/CoreService');
const RepairService = require('../models/RepairService');

dotenv.config();
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/appointment_scheduler';

const coreDefaults = [
  {
    name: 'Aircon Installation',
    slug: 'aircon-installation',
    category: 'service',
    description: 'Full split-type air conditioning installation (indoor + outdoor). Includes mounting, piping, vacuuming and system test.',
    features: ['Site survey', 'Mounting & securing', 'Refrigerant piping', 'Electrical hookup', 'System commissioning'],
    includedItems: ['Mounting brackets', 'Basic wiring', 'System vacuum & leak-check'],
    exclusions: ['High-rise rigging', 'Additional piping > 5m'],
    images: ['/images/servicesbg/tech.avif'],
    basePrice: 3500,
    priceRange: { min: 3500, max: 6500 },
    durationMinutes: 180,
    durationRange: { min: 120, max: 240 },
    tags: ['installation', 'split-type', 'onsite'],
    active: true,
    meta: { title: 'Aircon Installation', description: 'Professional aircon installation and commissioning.' }
  },
  {
    name: 'Aircon Cleaning',
    slug: 'aircon-cleaning',
    category: 'service',
    description: 'Thorough aircon chemical wash and filter cleanup to restore efficiency and airflow.',
    features: ['Chemical coil wash', 'Filter cleaning', 'Performance check'],
    includedItems: ['Cleaning solution', 'Filter re-installation'],
    exclusions: ['Deep coil repair', 'Motor replacement'],
    images: ['/images/servicesbg/techs.avif'],
    basePrice: 1200,
    durationMinutes: 90,
    tags: ['maintenance', 'cleaning'],
    active: true,
    meta: { title: 'Aircon Cleaning', description: 'Reduce energy usage and improve cooling with a professional cleaning.' }
  },
  {
    name: 'Freon Recharging',
    slug: 'freon-recharging',
    category: 'service',
    description: 'Recharge refrigerant to restore cooling performance. Includes system pressure check and leak inspection.',
    features: ['Vacuum & refill', 'Pressure test', 'System performance check'],
    includedItems: ['Refrigerant (standard quantity)', 'System test report'],
    exclusions: ['Major leak repair', 'Compressor replacement'],
    images: [],
    basePrice: 800,
    durationMinutes: 60,
    tags: ['maintenance', 'refrigerant'],
    active: true,
    meta: { title: 'Freon Recharging', description: 'Restore cooling by recharging refrigerant to manufacturer levels.' }
  },
  {
    name: 'Aircon Relocation',
    slug: 'aircon-relocation',
    category: 'service',
    description: 'Relocate an existing split-type unit to a new position within the same property. Includes dismantle, transport and reinstallation.',
    features: ['Dismantle & transport', 'Re-route piping', 'Re-install & test'],
    includedItems: ['Standard piping reroute', 'Basic mounting hardware'],
    exclusions: ['Long-distance transport', 'Additional piping > 5m'],
    images: [],
    basePrice: 2000,
    durationMinutes: 120,
    tags: ['relocation', 'installation'],
    active: true,
    meta: { title: 'Aircon Relocation', description: 'Move your aircon unit safely and re-commission at the new location.' }
  },
  {
    name: 'Dismantling & Reinstall',
    slug: 'dismantling-reinstall',
    category: 'service',
    description: 'Dismantle existing unit and reinstall (same site). Useful for renovation or maintenance access.',
    features: ['Careful dismantling', 'Reinstallation & testing'],
    includedItems: ['Basic re-mounting'],
    exclusions: ['Parts replacement', 'High-rise rigging'],
    images: [],
    basePrice: 2000,
    durationMinutes: 120,
    tags: ['dismantle', 'reinstall'],
    active: true,
    meta: { title: 'Dismantling & Reinstall', description: 'Safe dismantle and reinstall service for aircon units.' }
  },
  {
    name: 'System Reprocess',
    slug: 'system-reprocess',
    category: 'service',
    description: 'Quick system reprocess to address minor operational issues and recalibrate controls.',
    features: ['System flush', 'Control recalibration'],
    includedItems: [],
    exclusions: ['Major repairs'],
    images: [],
    basePrice: 1000,
    durationMinutes: 60,
    tags: ['maintenance', 'diagnostic'],
    active: true,
    meta: { title: 'System Reprocess', description: 'Minor system servicing to restore expected operation.' }
  },
  {
    name: 'Pump Down',
    slug: 'pump-down',
    category: 'service',
    description: 'Pump-down procedure to safely store refrigerant and isolate the system for transport or repair.',
    features: ['Safe refrigerant isolation', 'Leak-check'],
    includedItems: [],
    exclusions: ['Compressor work'],
    images: [],
    basePrice: 700,
    durationMinutes: 45,
    tags: ['maintenance'],
    active: true,
    meta: { title: 'Pump Down', description: 'Isolate and secure refrigerant for safe servicing or transport.' }
  },
  {
    name: 'Leak Testing',
    slug: 'leak-testing',
    category: 'service',
    description: 'Comprehensive leak testing and diagnostics for refrigerant systems.',
    features: ['Pressure testing', 'Electronic leak detection'],
    includedItems: [],
    exclusions: ['Major repairs', 'parts replacement'],
    images: [],
    basePrice: 700,
    durationMinutes: 45,
    tags: ['diagnostic', 'leak-test'],
    active: true,
    meta: { title: 'Leak Testing', description: 'Detect and locate leaks before recharging refrigerant.' }
  },
  {
    name: 'CCTV Installation',
    slug: 'cctv-installation',
    category: 'service',
    description: 'CCTV camera installation and configuration for single-site coverage.',
    features: ['Camera mounting', 'Wiring', 'NVR setup', 'Basic configuration'],
    includedItems: ['Standard camera mount', 'Basic wiring'],
    exclusions: ['Long distance cabling', 'Network-level firewall configuration'],
    images: [],
    basePrice: 1200,
    durationMinutes: 60,
    tags: ['security', 'installation'],
    active: true,
    meta: { title: 'CCTV Installation', description: 'Reliable CCTV installation for homes and small businesses.' }
  }
];

const repairDefaults = [
  {
    name: 'Refrigerator Repair',
    applianceType: 'refrigerator',
    commonFaults: ['Not cooling', 'Leaking', 'Noisy compressor'],
    parts: [ { name: 'Compressor', price: 4500 }, { name: 'Thermostat', price: 850 } ],
    basePrice: 1200,
    estimatedDurationMinutes: 90,
    warrantyDays: 30,
    availabilityLocations: [],
    active: true
  },
  {
    name: 'Washing Machine Repair',
    applianceType: 'washing-machine',
    commonFaults: ['Not draining', 'Spin failure', 'Noise'],
    parts: [ { name: 'Drain Pump', price: 1200 } ],
    basePrice: 1200,
    estimatedDurationMinutes: 90,
    warrantyDays: 14,
    availabilityLocations: [],
    active: true
  },
  {
    name: 'Microwave Oven Repair',
    applianceType: 'microwave',
    commonFaults: ['Not heating', 'Turntable not rotating', 'Sparking'],
    parts: [ { name: 'Magnetron', price: 2500 } ],
    basePrice: 800,
    estimatedDurationMinutes: 60,
    warrantyDays: 14,
    availabilityLocations: [],
    active: true
  },
  {
    name: 'Freezer Service',
    applianceType: 'freezer',
    commonFaults: ['Not cooling', 'Frost build-up', 'Leaking'],
    parts: [],
    basePrice: 1200,
    estimatedDurationMinutes: 90,
    warrantyDays: 30,
    availabilityLocations: [],
    active: true
  },
  {
    name: 'Dryer Repair',
    applianceType: 'dryer',
    commonFaults: ['Not heating', 'Drum not spinning', 'Vibration/noise'],
    parts: [],
    basePrice: 800,
    estimatedDurationMinutes: 60,
    warrantyDays: 14,
    availabilityLocations: [],
    active: true
  },
  {
    name: 'Rice Cooker Repair',
    applianceType: 'rice-cooker',
    commonFaults: ['Not powering on', 'Overcooking', 'Switch failure'],
    parts: [],
    basePrice: 700,
    estimatedDurationMinutes: 45,
    warrantyDays: 7,
    availabilityLocations: [],
    active: true
  },
  {
    name: 'Electric Fan Repair',
    applianceType: 'electric-fan',
    commonFaults: ['Wobbly motor', 'Noisy operation', 'Not oscillating'],
    parts: [],
    basePrice: 700,
    estimatedDurationMinutes: 45,
    warrantyDays: 7,
    availabilityLocations: [],
    active: true
  },
  {
    name: 'Water Dispenser Repair',
    applianceType: 'water-dispenser',
    commonFaults: ['Not dispensing', 'Leaking', 'Cooling issue'],
    parts: [],
    basePrice: 800,
    estimatedDurationMinutes: 60,
    warrantyDays: 14,
    availabilityLocations: [],
    active: true
  },
  {
    name: 'Electric Kettle Repair',
    applianceType: 'electric-kettle',
    commonFaults: ['Not heating', 'Auto-shutoff failure'],
    parts: [],
    basePrice: 500,
    estimatedDurationMinutes: 30,
    warrantyDays: 7,
    availabilityLocations: [],
    active: true
  }
];

async function run() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB');

  let created = 0;
  for (const svc of coreDefaults) {
    const existing = await CoreService.findOne({ slug: svc.slug });
    if (existing) {
      await CoreService.updateOne({ _id: existing._id }, { $set: svc });
    } else {
      await CoreService.create(svc);
      created += 1;
    }
  }

  for (const svc of repairDefaults) {
    const existing = await RepairService.findOne({ name: svc.name });
    if (existing) {
      await RepairService.updateOne({ _id: existing._id }, { $set: svc });
    } else {
      await RepairService.create(svc);
      created += 1;
    }
  }

  console.log(`Seeding CoreService/RepairService complete. New records created: ${created}`);
  await mongoose.disconnect();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});