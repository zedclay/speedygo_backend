export type WilayaRecord = {
  code: string;
  nameFr: string;
  nameAr: string;
  createdAt: string;
  updatedAt: string;
};

export type CommuneRecord = {
  id: number;
  wilayaCode: string;
  nameFr: string;
  nameAr: string;
  aliasesFr: string[];
  createdAt: string;
  updatedAt: string;
};

export type WilayaView = {
  code: string;
  nameFr: string;
  nameAr: string;
};

export type CommuneView = {
  id: number;
  wilayaCode: string;
  nameFr: string;
  nameAr: string;
  aliasesFr: string[];
};

export function toWilayaView(row: WilayaRecord): WilayaView {
  return {
    code: row.code,
    nameFr: row.nameFr,
    nameAr: row.nameAr,
  };
}

export function toCommuneView(row: CommuneRecord): CommuneView {
  return {
    id: row.id,
    wilayaCode: row.wilayaCode,
    nameFr: row.nameFr,
    nameAr: row.nameAr,
    aliasesFr: row.aliasesFr,
  };
}
