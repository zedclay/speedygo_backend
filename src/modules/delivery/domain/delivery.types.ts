export type DeliveryEventView = {
  type: string;
  occurredAt: string;
  driverId: string | null;
};

export type DeliveryPickupView = {
  merchantBranchId: string;
  name: string;
  addressText: string;
  latitude: number;
  longitude: number;
  phone: string | null;
};

export type DeliveryDropoffView = {
  addressText: string;
  latitude: number;
  longitude: number;
  instructions: string | null;
};

export type DeliveryDetailView = {
  id: string;
  orderId: string;
  publicReference: string;
  status: string;
  orderStatus: string;
  fulfillmentStatus: string;
  assignedDriverId: null;
  driverSearchStartedAt: string | null;
  pickedUpAt: string | null;
  estimatedArrivalAt: string | null;
  arrivedCustomerAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
  pickup: DeliveryPickupView;
  dropoff: DeliveryDropoffView;
  deliveryFeeMinor: number | null;
  events: DeliveryEventView[];
};

export type CustomerDeliveryView = Omit<DeliveryDetailView, 'pickup'> & {
  pickup: Omit<DeliveryPickupView, 'phone'>;
};

export type MerchantDeliveryView = Omit<DeliveryDetailView, 'deliveryFeeMinor'>;
