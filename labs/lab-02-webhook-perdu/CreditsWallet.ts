// CreditsWallet.ts — DONNÉ, hors de `src/`/`solution/`. Le vrai système de crédits déjà en
// place (structurellement intouchable) : chaque facture payée (`invoice.paid`) doit créditer
// le compte du client du montant payé, converti en crédits d'usage. Le bug du lab n'est PAS
// ici — il est dans la façon dont le handler webhook appelle ce wallet.
export class CreditsWallet {
  private readonly soldes = new Map<string, number>();

  crediter(customerId: string, montant: number): void {
    this.soldes.set(customerId, (this.soldes.get(customerId) ?? 0) + montant);
  }

  solde(customerId: string): number {
    return this.soldes.get(customerId) ?? 0;
  }
}
