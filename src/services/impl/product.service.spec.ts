import {
	describe, it, expect, beforeEach,
	afterEach,
} from 'vitest';
import {mockDeep, type DeepMockProxy} from 'vitest-mock-extended';
import {type INotificationService} from '../notifications.port.js';
import {createDatabaseMock, cleanUp} from '../../utils/test-utils/database-tools.ts.js';
import {ProductService} from './product.service.js';
import {products, type Product} from '@/db/schema.js';
import {type Database} from '@/db/type.js';

describe('ProductService Tests', () => {
	let notificationServiceMock: DeepMockProxy<INotificationService>;
	let productService: ProductService;
	let databaseMock: Database;
	let databaseName: string;
	let close: undefined | (() => void);

	beforeEach(async () => {
		({databaseMock, databaseName, close} = await createDatabaseMock());
		notificationServiceMock = mockDeep<INotificationService>();
		productService = new ProductService({
			ns: notificationServiceMock,
			db: databaseMock,
		});
	});

	afterEach(async () => {
		close?.();
		await cleanUp(databaseName);
	});

	it('should handle delay notification correctly', async () => {
		// GIVEN
		const product: Product = {
			id: 1,
			leadTime: 15,
			available: 0,
			type: 'NORMAL',
			name: 'RJ45 Cable',
			expiryDate: null,
			seasonStartDate: null,
			seasonEndDate: null,
		};
		await databaseMock.insert(products).values(product);

		// WHEN
		await productService.notifyDelay(product.leadTime, product);

		// THEN
		expect(product.available).toBe(0);
		expect(product.leadTime).toBe(15);
		expect(notificationServiceMock.sendDelayNotification).toHaveBeenCalledWith(product.leadTime, product.name);
		const result = await databaseMock.query.products.findFirst({
			where: (product, {eq}) => eq(product.id, product.id),
		});
		expect(result).toEqual(product);
	});

	it('NORMAL: should decrement available when in stock', async () => {
		const product: Product = {
			id: 1,
			leadTime: 15,
			available: 2,
			type: 'NORMAL',
			name: 'USB Cable',
			expiryDate: null,
			seasonStartDate: null,
			seasonEndDate: null,
		};
		await databaseMock.insert(products).values(product);

		await productService.processOneUnit(product, new Date());

		expect(notificationServiceMock.sendDelayNotification).not.toHaveBeenCalled();
		const result = await databaseMock.query.products.findFirst({
			where: (p, {eq}) => eq(p.id, product.id),
		});
		expect(result!.available).toBe(1);
	});

	it('NORMAL: should notify delay when out of stock and leadTime > 0', async () => {
		const product: Product = {
			id: 1,
			leadTime: 10,
			available: 0,
			type: 'NORMAL',
			name: 'USB Dongle',
			expiryDate: null,
			seasonStartDate: null,
			seasonEndDate: null,
		};
		await databaseMock.insert(products).values(product);

		await productService.processOneUnit(product, new Date());

		expect(notificationServiceMock.sendDelayNotification).toHaveBeenCalledWith(10, 'USB Dongle');
	});

	it('SEASONAL: should decrement available when within season and in stock', async () => {
		const now = new Date();
		const d = 24 * 60 * 60 * 1000;
		const product: Product = {
			id: 1,
			leadTime: 15,
			available: 3,
			type: 'SEASONAL',
			name: 'Watermelon',
			expiryDate: null,
			seasonStartDate: new Date(now.getTime() - (2 * d)),
			seasonEndDate: new Date(now.getTime() + (10 * d)),
		};
		await databaseMock.insert(products).values(product);

		await productService.processOneUnit(product, now);

		const result = await databaseMock.query.products.findFirst({
			where: (p, {eq}) => eq(p.id, product.id),
		});
		expect(result!.available).toBe(2);
	});

	it('SEASONAL: should mark unavailable and notify if restock occurs after season end', async () => {
		const now = new Date();
		const d = 24 * 60 * 60 * 1000;
		const product: Product = {
			id: 1,
			leadTime: 30,
			available: 0,
			type: 'SEASONAL',
			name: 'Grapes',
			expiryDate: null,
			seasonStartDate: new Date(now.getTime() - (2 * d)),
			seasonEndDate: new Date(now.getTime() + (10 * d)),
		};
		await databaseMock.insert(products).values(product);

		await productService.processOneUnit(product, now);

		expect(notificationServiceMock.sendOutOfStockNotification).toHaveBeenCalledWith('Grapes');
		const result = await databaseMock.query.products.findFirst({
			where: (p, {eq}) => eq(p.id, product.id),
		});
		expect(result!.available).toBe(0);
	});

	it('EXPIRABLE: should decrement available when not expired', async () => {
		const now = new Date();
		const d = 24 * 60 * 60 * 1000;
		const product: Product = {
			id: 1,
			leadTime: 15,
			available: 2,
			type: 'EXPIRABLE',
			name: 'Butter',
			expiryDate: new Date(now.getTime() + (10 * d)),
			seasonStartDate: null,
			seasonEndDate: null,
		};
		await databaseMock.insert(products).values(product);

		await productService.processOneUnit(product, now);

		const result = await databaseMock.query.products.findFirst({
			where: (p, {eq}) => eq(p.id, product.id),
		});
		expect(result!.available).toBe(1);
	});

	it('EXPIRABLE: should notify expiration and set available to 0 when expired', async () => {
		const now = new Date();
		const d = 24 * 60 * 60 * 1000;
		const expiryDate = new Date(now.getTime() - (2 * d));
		const product: Product = {
			id: 1,
			leadTime: 15,
			available: 6,
			type: 'EXPIRABLE',
			name: 'Milk',
			expiryDate,
			seasonStartDate: null,
			seasonEndDate: null,
		};
		await databaseMock.insert(products).values(product);

		await productService.processOneUnit(product, now);

		expect(notificationServiceMock.sendExpirationNotification).toHaveBeenCalledWith('Milk', expiryDate);
		const result = await databaseMock.query.products.findFirst({
			where: (p, {eq}) => eq(p.id, product.id),
		});
		expect(result!.available).toBe(0);
	});
});

