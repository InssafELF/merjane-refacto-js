import {type Cradle} from '@fastify/awilix';
import {eq} from 'drizzle-orm';
import {type INotificationService} from '../notifications.port.js';
import {products, type Product} from '@/db/schema.js';
import {type Database} from '@/db/type.js';

type Now = Date;
type ProductType = 'NORMAL' | 'SEASONAL' | 'EXPIRABLE';

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export class ProductService {
	private readonly ns: INotificationService;
	private readonly db: Database;

	public constructor({ns, db}: Pick<Cradle, 'ns' | 'db'>) {
		this.ns = ns;
		this.db = db;
	}

	/**
	 * Process the purchase of exactly 1 unit for the given product.
	 *
	 * Business rules are described in the technical test statement:
	 *  - NORMAL: decrement if available, otherwise (if leadTime > 0) notify delay.
	 *  - SEASONAL: decrement only if within season & available, otherwise apply seasonal rules.
	 *  - EXPIRABLE: decrement only if not expired & available, otherwise apply expiration rules.
	 */
	public async processOneUnit(product: Product, now: Now = new Date()): Promise<void> {
		switch (product.type as ProductType) {
			case 'NORMAL': {
				await this.processNormalProduct(product);
				return;
			}

			case 'SEASONAL': {
				await this.processSeasonalProduct(product, now);
				return;
			}

			case 'EXPIRABLE': {
				await this.processExpirableProduct(product, now);
				return;
			}
		}
	}

	private async processNormalProduct(product: Product): Promise<void> {
		if (product.available > 0) {
			await this.decrementAvailable(product);
			return;
		}

		if (product.leadTime > 0) {
			await this.notifyDelay(product.leadTime, product);
		}
	}

	private async processSeasonalProduct(product: Product, now: Now): Promise<void> {
		if (this.isWithinSeason(product, now) && product.available > 0) {
			await this.decrementAvailable(product);
			return;
		}

		await this.handleSeasonalProduct(product, now);
	}

	private async processExpirableProduct(product: Product, now: Now): Promise<void> {
		if (product.available > 0 && this.isNotExpired(product, now)) {
			await this.decrementAvailable(product);
			return;
		}

		await this.handleExpiredProduct(product, now);
	}

	private async decrementAvailable(product: Product): Promise<void> {
		await this.updateProduct(product.id, {available: product.available - 1});
	}

	private async updateProduct(productId: number, patch: Partial<Product>): Promise<void> {
		await this.db.update(products).set(patch).where(eq(products.id, productId));
	}

	public async notifyDelay(leadTime: number, p: Product): Promise<void> {
		await this.updateProduct(p.id, {leadTime});
		this.ns.sendDelayNotification(leadTime, p.name);
	}

	public async handleSeasonalProduct(p: Product, now: Now = new Date()): Promise<void> {
		const expectedRestockDate = new Date(now.getTime() + (p.leadTime * DAY_IN_MS));
		if (expectedRestockDate > p.seasonEndDate!) {
			this.ns.sendOutOfStockNotification(p.name);
			await this.updateProduct(p.id, {available: 0});
			return;
		}

		if (p.seasonStartDate! > now) {
			this.ns.sendOutOfStockNotification(p.name);
			// Keep a DB write (the previous implementation was writing the whole object).
			await this.updateProduct(p.id, {available: p.available, leadTime: p.leadTime});
			return;
		}

		await this.notifyDelay(p.leadTime, p);
	}

	private isWithinSeason(p: Product, now: Now): boolean {
		return Boolean(p.seasonStartDate && p.seasonEndDate && now > p.seasonStartDate && now < p.seasonEndDate);
	}

	public async handleExpiredProduct(p: Product, now: Now = new Date()): Promise<void> {
		if (p.available > 0 && this.isNotExpired(p, now)) {
			await this.decrementAvailable(p);
			return;
		}

		this.ns.sendExpirationNotification(p.name, p.expiryDate!);
		await this.updateProduct(p.id, {available: 0});
	}

	private isNotExpired(p: Product, now: Now): boolean {
		return Boolean(p.expiryDate && p.expiryDate > now);
	}
}
