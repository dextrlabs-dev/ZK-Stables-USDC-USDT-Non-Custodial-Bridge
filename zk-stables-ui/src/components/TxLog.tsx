import React from 'react';
import {
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useZkStables } from '../hooks/useZkStables.js';

export const TxLog: React.FC = () => {
  const { txLog } = useZkStables();

  return (
    <Card id="panel-tx-log" variant="outlined">
      <CardContent>
        <Typography variant="h6" component="h3" gutterBottom>
          Midnight transaction log
        </Typography>
        {txLog.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No Midnight transactions recorded yet. Deploy or join a contract, then run steps in <strong>Midnight contract
            actions</strong> — rows will appear here with ids and hashes.
          </Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Step</TableCell>
                <TableCell>Transaction id</TableCell>
                <TableCell>Transaction hash</TableCell>
                <TableCell>Block</TableCell>
                <TableCell>Time</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {txLog.map((row) => (
                <TableRow key={`${row.label}-${row.txId}-${row.at}`}>
                  <TableCell>{row.label}</TableCell>
                  <TableCell
                    sx={(t) => ({
                      ...t.typography.dataMonoDense,
                      maxWidth: 160,
                      wordBreak: 'break-all',
                    })}
                  >
                    {row.txId}
                  </TableCell>
                  <TableCell
                    sx={(t) => ({
                      ...t.typography.dataMonoDense,
                      maxWidth: 160,
                      wordBreak: 'break-all',
                    })}
                  >
                    {row.txHash}
                  </TableCell>
                  <TableCell sx={{ fontVariantNumeric: 'tabular-nums' }}>{row.blockHeight?.toString() ?? '—'}</TableCell>
                  <TableCell sx={{ typography: 'caption' }}>{row.at}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
};
