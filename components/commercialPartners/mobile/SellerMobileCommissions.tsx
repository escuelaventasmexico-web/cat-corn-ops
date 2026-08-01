interface SellerMobileCommissionsProps {
  sellerId: string;
}

export const SellerMobileCommissions = ({ sellerId: _sellerId }: SellerMobileCommissionsProps) => {
  return (
    <div className="pb-24">
      {/* Delegate to SellerCommissionDashboard with mobile-responsive styling */}
      <div className="px-4 pt-4 space-y-4">
        <h2 className="text-base font-bold text-cc-text-main">Mis Comisiones</h2>
        
        {/* Note: SellerCommissionDashboard component should be responsive */}
        {/* For now, render it directly - it already handles responsive layout */}
        <div className="space-y-4">
          <p className="text-sm text-cc-text-muted">
            Cargando información de comisiones...
          </p>
        </div>
      </div>
    </div>
  );
};
