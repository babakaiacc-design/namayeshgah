import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { HealthController } from './health.controller';

describe('HealthController', () => {
  const buildController = async (query: jest.Mock) => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: getDataSourceToken(), useValue: { query } as Partial<DataSource> }],
    }).compile();

    return moduleRef.get(HealthController);
  };

  it('reports ok when the database answers', async () => {
    const query = jest.fn().mockResolvedValue([{ '?column?': 1 }]);
    const controller = await buildController(query);

    const result = await controller.check();

    expect(query).toHaveBeenCalledWith('SELECT 1');
    expect(result.status).toBe('ok');
    expect(result.database).toBe('up');
  });

  it('reports degraded instead of throwing when the database is unreachable', async () => {
    // Render wakes the service before Supabase has resumed, so the health
    // endpoint must answer rather than 500 — otherwise the keepalive job in
    // .github/workflows/sync.yml can never see the service come up.
    const query = jest.fn().mockRejectedValue(new Error('connection refused'));
    const controller = await buildController(query);

    const result = await controller.check();

    expect(result.status).toBe('degraded');
    expect(result.database).toBe('down');
  });

  it('returns an ISO timestamp and uptime', async () => {
    const controller = await buildController(jest.fn().mockResolvedValue([]));

    const result = await controller.check();

    expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
    expect(result.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });
});
