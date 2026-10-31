// Departments of a classic SS14 station and what each one needs to work in a round, for the Department submode.
// A department is split into areas (sub-departments, e.g. Engineering's Atmospherics); the map maker ticks the
// areas the part holds and gets the checks of those areas only.
//
// Ids are the upstream SS14 / Qlippoth prototype ids (checked against Resources/Prototypes). A requirement is met
// when any placed entity id starts with one of its prefixes; circuit boards, flatpacks and other parts that are
// not the machine itself do not count.

export const DEPARTMENTS = ["engineering", "medical", "science", "security", "cargo", "service", "command"] as const;
export type DepartmentId = (typeof DEPARTMENTS)[number];

export interface Requirement {
  /** Entity id prefixes; any one placed meets the requirement. */
  any: string[];
  /** What is missing, e.g. "chemical dispenser (ChemDispenser)". */
  what: string;
  /** Why it matters; written after the name. */
  why?: string;
  /** "error": the department cannot do its job without it (critical); otherwise a warning. */
  level?: "error";
  /** Only checked when one of these is placed (e.g. the singularity's containment once there is a singularity). */
  when?: string[];
}

export interface DepartmentArea {
  id: string;
  name: string;
  hint: string;
  /** Not ticked by default: rooms many stations leave out. */
  optional?: boolean;
  needs: Requirement[];
}

export interface DepartmentInfo {
  id: DepartmentId;
  name: string;
  /** The game's department color (Resources/Prototypes/Roles/Jobs/departments.yml), lightened where it is too dark to read. */
  color: string;
  areas: DepartmentArea[];
}

const spawn = (job: string, name: string, level?: "error"): Requirement => ({
  any: [`SpawnPoint${job}`],
  what: `${name} spawn point (SpawnPoint${job})`,
  why: level ? "nobody can join as this job" : undefined,
  level,
});
const need = (any: string | string[], what: string, why?: string, level?: "error", when?: string[]): Requirement => ({
  any: typeof any === "string" ? [any] : any,
  what,
  why,
  level,
  when,
});

export const DEPARTMENT_INFO: Record<DepartmentId, DepartmentInfo> = {
  engineering: {
    id: "engineering",
    name: "Engineering",
    color: "#efb341",
    areas: [
      {
        id: "main",
        name: "Engineering",
        hint: "Main room, the Chief Engineer's office and the engineers' lockers",
        needs: [
          spawn("StationEngineer", "Station Engineer", "error"),
          spawn("ChiefEngineer", "Chief Engineer"),
          spawn("TechnicalAssistant", "Technical Assistant"),
          need("LockerChiefEngineer", "Chief Engineer's locker (LockerChiefEngineer)"),
          need("LockerEngineer", "engineer's locker (LockerEngineer)", "engineers start without tools and insulated gloves"),
          need(["VendingMachineEngivend", "VendingMachineYouTool"], "tool vendor (VendingMachineEngivend / VendingMachineYouTool)"),
          need("VendingMachineEngiDrobe", "EngiDrobe (VendingMachineEngiDrobe)"),
          need("Autolathe", "autolathe (Autolathe)"),
          need("ComputerPowerMonitoring", "power monitoring console (ComputerPowerMonitoring)"),
          need("ComputerAlert", "alerts console (ComputerAlert)"),
        ],
      },
      {
        id: "power",
        name: "Engine & power storage",
        hint: "The station's power generation and the SMES room",
        needs: [
          need(
            ["AmeController", "SingularityGenerator", "TeslaGenerator", "SolarPanel", "GeneratorRTG", "PortableGenerator"],
            "power generator (AME, singularity, tesla, solars, RTG or a PACMAN)",
            "the station runs on batteries until they are empty",
            "error"
          ),
          need("SMES", "SMES (power storage)", "the generator's power has nowhere to go", "error"),
          need("Substation", "substation", "the SMES cannot feed the station", "error"),
          need(["AmeShielding", "CrateEngineeringAMEShielding"], "AME shielding (AmeShielding or a CrateEngineeringAMEShielding)", "the AME controller does nothing on its own", undefined, ["AmeController"]),
          need("Emitter", "emitter (Emitter)", "the containment field cannot be powered", "error", ["SingularityGenerator", "TeslaGenerator"]),
          need("ContainmentFieldGenerator", "containment field generator", "the singularity or tesla gets loose", "error", ["SingularityGenerator", "TeslaGenerator"]),
          need("ParticleAcceleratorControlBox", "particle accelerator", "the singularity or tesla cannot grow", undefined, ["SingularityGenerator", "TeslaGenerator"]),
          need("RadiationCollector", "radiation collectors", "the singularity gives no power", "error", ["SingularityGenerator"]),
          need(["SolarTracker", "ComputerSolarControl"], "solar tracker or solar control console", "the panels do not turn to the sun", undefined, ["SolarPanel"]),
        ],
      },
      {
        id: "atmos",
        name: "Atmospherics",
        hint: "Gas miners or canisters, the air mix and the distribution loop",
        needs: [
          spawn("Atmos", "Atmospheric Technician", "error"),
          need(["GasMinerOxygen", "OxygenCanister"], "oxygen source (GasMinerOxygen or OxygenCanister)", "the station's air cannot be refilled", "error"),
          need(["GasMinerNitrogen", "NitrogenCanister"], "nitrogen source (GasMinerNitrogen or NitrogenCanister)", "the station's air cannot be refilled", "error"),
          need("GasMixer", "gas mixer (GasMixer)", "oxygen and nitrogen are not mixed into air"),
          need(["GasPressurePump", "GasVolumePump"], "gas pump (GasPressurePump / GasVolumePump)", "air does not reach the distribution loop"),
          need("GasFilter", "gas filter (GasFilter)", "the waste loop cannot be cleaned"),
          need("GasThermoMachineFreezer", "freezer (GasThermoMachineFreezer)"),
          need("GasPort", "connector port (GasPort)", "canisters cannot be hooked up"),
          need("ComputerAtmosMonitoring", "atmospheric monitoring console (ComputerAtmosMonitoring)"),
          need("LockerAtmospherics", "atmospheric technician's locker (LockerAtmospherics)"),
          need("VendingMachineAtmosDrobe", "AtmosDrobe (VendingMachineAtmosDrobe)"),
        ],
      },
      {
        id: "telecomms",
        name: "Telecommunications",
        hint: "Telecom servers for the radio channels",
        needs: [need("TelecomServer", "telecom server (TelecomServer)", "headsets do not work", "error")],
      },
    ],
  },
  medical: {
    id: "medical",
    name: "Medical",
    color: "#52b4e9",
    areas: [
      {
        id: "main",
        name: "Medbay",
        hint: "Lobby, treatment and the Chief Medical Officer's office",
        needs: [
          spawn("MedicalDoctor", "Medical Doctor", "error"),
          spawn("ChiefMedicalOfficer", "Chief Medical Officer"),
          spawn("MedicalIntern", "Medical Intern"),
          spawn("Paramedic", "Paramedic"),
          need("LockerChiefMedicalOfficer", "Chief Medical Officer's locker (LockerChiefMedicalOfficer)"),
          need("LockerMedical", "medical doctor's locker (LockerMedical)"),
          need("VendingMachineMedical", "NanoMed (VendingMachineMedical)", "doctors have no medicine to start with", "error"),
          need("VendingMachineMediDrobe", "MediDrobe (VendingMachineMediDrobe)"),
          need(["MedicalBed", "StasisBed"], "medical bed (MedicalBed / StasisBed)"),
          need("MedicalTechFab", "medical techfab (MedicalTechFab)"),
          need("ComputerCrewMonitoring", "crew monitoring console (ComputerCrewMonitoring)", "nobody sees who is hurt or dead"),
          need("ComputerMedicalRecords", "medical records console (ComputerMedicalRecords)"),
        ],
      },
      {
        id: "chemistry",
        name: "Chemistry",
        hint: "Dispensers and the ChemMaster",
        needs: [
          spawn("Chemist", "Chemist", "error"),
          need("ChemDispenser", "chemical dispenser (ChemDispenser)", "no chemicals can be made", "error"),
          need("ChemMaster", "ChemMaster (ChemMaster)", "medicine cannot be bottled or made into pills", "error"),
          need("ChemistryHotplate", "hotplate (ChemistryHotplate)", "reactions that need heat cannot be done"),
          need("LockerChemistry", "chemist's locker (LockerChemistry)"),
          need("VendingMachineChemicals", "ChemVend (VendingMachineChemicals)"),
        ],
      },
      {
        id: "cryo",
        name: "Cryogenics & surgery",
        hint: "Cryo pods and the operating room",
        needs: [
          need("CryoPod", "cryo pod (CryoPod)", "badly hurt crew cannot be healed in cryo"),
          need("GasThermoMachineFreezer", "freezer (GasThermoMachineFreezer)", "cryo pods need cold gas", undefined, ["CryoPod"]),
          need("OperatingTable", "operating table (OperatingTable)", "no surgery can be done"),
        ],
      },
      {
        id: "morgue",
        name: "Morgue",
        hint: "Body storage",
        needs: [need("Morgue", "morgue tray (Morgue)", "bodies rot in the halls", "error")],
      },
      {
        id: "cloning",
        name: "Cloning",
        hint: "Cloning pod and its console (most current maps have none)",
        optional: true,
        needs: [
          need("CloningPod", "cloning pod (CloningPod)", undefined, "error"),
          need("ComputerCloningConsole", "cloning console (ComputerCloningConsole)", "the pod cannot be started", "error"),
        ],
      },
    ],
  },
  science: {
    id: "science",
    name: "Science",
    color: "#d381c9",
    areas: [
      {
        id: "main",
        name: "Research & development",
        hint: "The R&D lab, the server room and the Research Director's office",
        needs: [
          spawn("Scientist", "Scientist", "error"),
          spawn("ResearchDirector", "Research Director"),
          spawn("ResearchAssistant", "Research Assistant"),
          need("ResearchAndDevelopmentServer", "R&D server (ResearchAndDevelopmentServer)", "no research points are made", "error"),
          need("ComputerResearchAndDevelopment", "R&D console (ComputerResearchAndDevelopment)", "nothing can be researched", "error"),
          need("Protolathe", "protolathe (Protolathe)", "researched items cannot be made", "error"),
          need("CircuitImprinter", "circuit imprinter (CircuitImprinter)", "machine upgrades cannot be made"),
          need("LockerResearchDirector", "Research Director's locker (LockerResearchDirector)"),
          need(["LockerScientist", "LockerScience"], "scientist's locker (LockerScienceFilled)"),
          need("VendingMachineSciDrobe", "SciDrobe (VendingMachineSciDrobe)"),
        ],
      },
      {
        id: "robotics",
        name: "Robotics",
        hint: "Borg and mech building",
        needs: [
          need("ExosuitFabricator", "exosuit fabricator (ExosuitFabricator)", "no borgs or mechs can be built", "error"),
          need("VendingMachineRobotics", "Robotech Deluxe (VendingMachineRobotics)"),
        ],
      },
      {
        id: "xenoarch",
        name: "Xenoarchaeology",
        hint: "Artifact analysis",
        needs: [
          need("MachineArtifactAnalyzer", "artifact analyzer (MachineArtifactAnalyzer)", "artifacts cannot be studied", "error"),
          need("ComputerAnalysisConsole", "analysis console (ComputerAnalysisConsole)", "the analyzer cannot be used", "error"),
        ],
      },
      {
        id: "anomaly",
        name: "Anomalous research",
        hint: "Anomaly vessels and the A.P.E.",
        needs: [
          need("MachineAnomalyVessel", "anomaly vessel (MachineAnomalyVessel)", "anomalies give no research points", "error"),
          need("MachineAPE", "A.P.E. (MachineAPE)", "anomalies cannot be stabilized"),
          need("MachineAnomalyGenerator", "anomaly generator (MachineAnomalyGenerator)"),
        ],
      },
    ],
  },
  security: {
    id: "security",
    name: "Security",
    color: "#de3a3a",
    areas: [
      {
        id: "main",
        name: "Security office",
        hint: "Officers' lockers, the techfab and the Head of Security's office",
        needs: [
          spawn("SecurityOfficer", "Security Officer", "error"),
          spawn("HeadOfSecurity", "Head of Security"),
          spawn("SecurityCadet", "Security Cadet"),
          need("LockerSecurity", "security officer's locker (LockerSecurity)", "officers start without their gear"),
          need("LockerHeadOfSecurity", "Head of Security's locker (LockerHeadOfSecurity)"),
          need("VendingMachineSec", "SecTech (VendingMachineSec)"),
          need("VendingMachineSecDrobe", "SecDrobe (VendingMachineSecDrobe)"),
          need("SecurityTechFab", "security techfab (SecurityTechFab)"),
          need("ComputerCriminalRecords", "criminal records console (ComputerCriminalRecords)", "nobody can be set to wanted"),
          need("ComputerSurveillanceCameraMonitor", "camera monitor (ComputerSurveillanceCameraMonitor)"),
        ],
      },
      {
        id: "armory",
        name: "Armory & warden",
        hint: "The warden's post and the locked weapon storage",
        needs: [
          spawn("Warden", "Warden"),
          need("LockerWarden", "warden's locker (LockerWarden)"),
          need("GunSafe", "gun safe (GunSafe)", "the armory has no weapons"),
          need("AirlockArmory", "armory airlock (AirlockArmory…Locked)", "anyone with security access walks into the armory"),
        ],
      },
      {
        id: "brig",
        name: "Brig",
        hint: "Cells for prisoners",
        needs: [
          need(["AirlockBrig", "WindoorSecureSecurityLocked", "WindoorSecureBrigLocked"], "locked cell door (AirlockBrig…Locked or a security windoor)", "prisoners walk out", "error"),
        ],
      },
      {
        id: "detective",
        name: "Detective's office",
        hint: "The detective's room",
        needs: [spawn("Detective", "Detective"), need("LockerDetective", "detective's locker (LockerDetective)"), need("LockerEvidence", "evidence locker (LockerEvidence)")],
      },
    ],
  },
  cargo: {
    id: "cargo",
    name: "Cargo",
    color: "#c58a3e",
    areas: [
      {
        id: "main",
        name: "Cargo bay",
        hint: "Ordering, the cargo shuttle dock and the Quartermaster's office",
        needs: [
          spawn("CargoTechnician", "Cargo Technician", "error"),
          spawn("Quartermaster", "Quartermaster"),
          need("ComputerCargoOrders", "cargo order console (ComputerCargoOrders)", "nothing can be ordered", "error"),
          need("ComputerCargoBounty", "cargo bounty console (ComputerCargoBounty)"),
          need(["ComputerShuttleCargo", "ComputerCargoShuttle"], "cargo shuttle console (ComputerShuttleCargo)", "the cargo shuttle cannot be flown to the trade station"),
          need("LockerQuarterMaster", "Quartermaster's locker (LockerQuarterMaster)"),
          need("VendingMachineCargoDrobe", "CargoDrobe (VendingMachineCargoDrobe)"),
        ],
      },
      {
        id: "salvage",
        name: "Salvage",
        hint: "Salvage magnet, expeditions and ore processing",
        needs: [
          spawn("SalvageSpecialist", "Salvage Specialist", "error"),
          need("SalvageMagnet", "salvage magnet (SalvageMagnet)", "no wrecks or asteroids can be pulled in", "error"),
          need("ComputerSalvageExpedition", "salvage expedition console (ComputerSalvageExpedition)"),
          need("OreProcessor", "ore processor (OreProcessor)", "mined ore cannot be turned into materials"),
          need("LockerSalvageSpecialist", "salvage specialist's locker (LockerSalvageSpecialist)"),
          need("VendingMachineSalvage", "Salvage Vendor (VendingMachineSalvage)"),
        ],
      },
    ],
  },
  service: {
    id: "service",
    name: "Service",
    color: "#9fed58",
    areas: [
      {
        id: "bar",
        name: "Bar",
        hint: "Bar counter and drink dispensers",
        needs: [
          spawn("Bartender", "Bartender", "error"),
          need("BoozeDispenser", "booze dispenser (BoozeDispenser)", undefined, "error"),
          need("SodaDispenser", "soda dispenser (SodaDispenser)"),
          need("VendingMachineBooze", "Booze-O-Mat (VendingMachineBooze)"),
          need("LockerBooze", "bartender's locker (LockerBooze)"),
        ],
      },
      {
        id: "kitchen",
        name: "Kitchen",
        hint: "Cooking and the freezer",
        needs: [
          spawn("Chef", "Chef", "error"),
          need("KitchenMicrowave", "microwave (KitchenMicrowave)", "nothing can be cooked", "error"),
          need("KitchenReagentGrinder", "reagent grinder (KitchenReagentGrinder)"),
          need("KitchenSpike", "meat spike (KitchenSpike)"),
          need("LockerFreezer", "freezer locker (LockerFreezer)"),
          need("VendingMachineChefvend", "ChefVend (VendingMachineChefvend)"),
          need("VendingMachineDinnerware", "Plasteel Chef's Dinnerware Vendor (VendingMachineDinnerware)"),
        ],
      },
      {
        id: "hydroponics",
        name: "Hydroponics",
        hint: "Plant trays and seeds",
        needs: [
          spawn("Botanist", "Botanist", "error"),
          need(["hydroponicsTray", "HydroponicsTray"], "hydroponics tray (hydroponicsTray)", "nothing can be grown", "error"),
          need("VendingMachineSeeds", "MegaSeed Servitor (VendingMachineSeeds)", "botanists have no seeds", "error"),
          need("VendingMachineNutri", "NutriMax (VendingMachineNutri)"),
          need("SeedExtractor", "seed extractor (SeedExtractor)"),
          need("LockerBotanist", "botanist's locker (LockerBotanist)"),
        ],
      },
      {
        id: "janitor",
        name: "Janitor's closet",
        hint: "Cleaning gear",
        needs: [
          spawn("Janitor", "Janitor", "error"),
          need(["JanitorialTrolley", "MopBucket"], "janitorial trolley or mop bucket"),
          need("ClosetJanitor", "janitor's closet (ClosetJanitor)"),
          need("VendingMachineJaniDrobe", "JaniDrobe (VendingMachineJaniDrobe)"),
        ],
      },
      {
        id: "chapel",
        name: "Chapel",
        hint: "The chaplain's chapel and crematorium",
        optional: true,
        needs: [spawn("Chaplain", "Chaplain"), need("Altar", "altar"), need("Crematorium", "crematorium (Crematorium)"), need("VendingMachineChapel", "PietyVend (VendingMachineChapel)")],
      },
      {
        id: "library",
        name: "Library",
        hint: "Bookshelves and the librarian",
        optional: true,
        needs: [spawn("Librarian", "Librarian"), need("Bookshelf", "bookshelf (Bookshelf)")],
      },
      {
        id: "theatre",
        name: "Theatre",
        hint: "Clown, mime and musician",
        optional: true,
        needs: [spawn("Clown", "Clown"), spawn("Mime", "Mime"), spawn("Musician", "Musician"), need("VendingMachineTheater", "AutoDrobe (VendingMachineTheater)")],
      },
    ],
  },
  command: {
    id: "command",
    name: "Command",
    color: "#6d8fc4",
    areas: [
      {
        id: "bridge",
        name: "Bridge",
        hint: "Command consoles",
        needs: [
          need("ComputerComms", "communications console (ComputerComms)", "no announcements and the emergency shuttle cannot be called from the station", "error"),
          need("ComputerId", "ID card console (ComputerId)", "nobody can be given access", "error"),
          need("ComputerCrewMonitoring", "crew monitoring console (ComputerCrewMonitoring)"),
          need("ComputerStationRecords", "station records console (ComputerStationRecords)"),
          need("ComputerSurveillanceCameraMonitor", "camera monitor (ComputerSurveillanceCameraMonitor)"),
          need("ComputerAlert", "alerts console (ComputerAlert)"),
        ],
      },
      {
        id: "captain",
        name: "Captain's quarters",
        hint: "The captain's office and bedroom",
        needs: [
          spawn("Captain", "Captain", "error"),
          need("LockerCaptain", "captain's locker (LockerCaptain)", "the captain starts without the spare ID and the nuke disk", "error"),
          need("FaxMachineCaptain", "captain's fax (FaxMachineCaptain)"),
        ],
      },
      {
        id: "hop",
        name: "Head of Personnel's office",
        hint: "Access changes and job changes",
        needs: [
          spawn("HeadOfPersonnel", "Head of Personnel", "error"),
          need("ComputerId", "ID card console (ComputerId)", "the HoP cannot change access", "error"),
          need("LockerHeadOfPersonnel", "Head of Personnel's locker (LockerHeadOfPersonnel)"),
        ],
      },
      {
        id: "vault",
        name: "Vault",
        hint: "The station's nuke",
        needs: [need("NuclearBomb", "nuclear bomb (NuclearBomb)", "nuclear operatives have nothing to blow up", "error")],
      },
      {
        id: "ai",
        name: "AI core",
        hint: "The station AI",
        optional: true,
        needs: [need("PlayerStationAi", "station AI core (PlayerStationAi)", "nobody can join as the AI", "error")],
      },
    ],
  },
};

/** The areas ticked when a department is first picked: all but the optional ones. */
export function defaultAreas(department: DepartmentId): string[] {
  return DEPARTMENT_INFO[department].areas.filter((area) => !area.optional).map((area) => area.id);
}

export function isDepartment(value: unknown): value is DepartmentId {
  return typeof value === "string" && (DEPARTMENTS as readonly string[]).includes(value);
}
