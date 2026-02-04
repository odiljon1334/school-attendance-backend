import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

type AxiosInstance = ReturnType<typeof axios.create>;

@Injectable()
export class HikvisionApiService {
  private readonly logger = new Logger(HikvisionApiService.name);

  /**
   * Create authenticated HTTP client for Hikvision device
   */
  private createClient(ipAddress: string, port: number, username: string, password: string): AxiosInstance {
    return axios.create({
      baseURL: `http://${ipAddress}:${port}`,
      auth: {
        username,
        password,
      },
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Test device connection
   */
  async testConnection(ipAddress: string, port: number, username: string, password: string): Promise<boolean> {
    try {
      const client = this.createClient(ipAddress, port, username, password);
      const response = await client.get('/ISAPI/System/deviceInfo');
      return response.status === 200;
    } catch (error) {
      this.logger.error(`Failed to connect to device ${ipAddress}:${port}`, error);
      return false;
    }
  }

  /**
   * Get device information
   */
  async getDeviceInfo(ipAddress: string, port: number, username: string, password: string) {
    try {
      const client = this.createClient(ipAddress, port, username, password);
      const response = await client.get('/ISAPI/System/deviceInfo');
      return response.data;
    } catch (error) {
      this.logger.error('Failed to get device info', error);
      throw error;
    }
  }

  /**
   * Register a face to the device
   */
  async registerFace(
    ipAddress: string,
    port: number,
    username: string,
    password: string,
    personId: string,
    personName: string,
    faceImageBase64: string,
  ): Promise<boolean> {
    try {
      const client = this.createClient(ipAddress, port, username, password);

      // Step 1: Add person
      const personData = {
        UserInfo: {
          employeeNo: personId,
          name: personName,
          userType: 'normal',
          Valid: {
            enable: true,
            beginTime: new Date().toISOString(),
            endTime: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year
          },
        },
      };

      await client.post('/ISAPI/AccessControl/UserInfo/Record', personData, {
        params: { format: 'json' },
      });

      // Step 2: Upload face image
      const faceData = {
        FaceInfo: {
          employeeNo: personId,
          faceLibType: 'blackFD',
          FDID: '1',
          FPID: '1',
        },
        faceData: faceImageBase64,
      };

      await client.post('/ISAPI/Intelligent/FDLib/FaceDataRecord', faceData, {
        params: { format: 'json' },
      });

      this.logger.log(`Face registered successfully for ${personName} (${personId})`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to register face for ${personId}`, error);
      return false;
    }
  }

  /**
   * Delete a face from the device
   */
  async deleteFace(
    ipAddress: string,
    port: number,
    username: string,
    password: string,
    personId: string,
  ): Promise<boolean> {
    try {
      const client = this.createClient(ipAddress, port, username, password);

      // Delete person (this will also delete associated faces)
      await client.request({
        method: 'DELETE',
        url: `/ISAPI/AccessControl/UserInfo/Delete`,
        params: { format: 'json' },
        data: {
          UserInfoDelCond: {
            EmployeeNoList: [{ employeeNo: personId }],
          },
        },
      });

      this.logger.log(`Face deleted successfully for ${personId}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to delete face for ${personId}`, error);
      return false;
    }
  }

  /**
   * Get access control events (face recognition logs)
   */
  async getAccessEvents(
    ipAddress: string,
    port: number,
    username: string,
    password: string,
    startTime: Date,
    endTime: Date,
  ) {
    try {
      const client = this.createClient(ipAddress, port, username, password);

      const response = await client.post(
        '/ISAPI/AccessControl/AcsEvent',
        {
          AcsEventCond: {
            searchID: '1',
            searchResultPosition: 0,
            maxResults: 100,
            major: 5, // Access control event
            minor: 75, // Face recognition
            startTime: startTime.toISOString(),
            endTime: endTime.toISOString(),
          },
        },
        {
          params: { format: 'json' },
        },
      );

      return response.data;
    } catch (error) {
      this.logger.error('Failed to get access events', error);
      throw error;
    }
  }

  /**
   * Subscribe to real-time events via HTTP push
   */
  async subscribeToEvents(
    ipAddress: string,
    port: number,
    username: string,
    password: string,
    callbackUrl: string,
  ): Promise<boolean> {
    try {
      const client = this.createClient(ipAddress, port, username, password);

      const subscriptionData = {
        HttpHostNotification: {
          id: '1',
          url: callbackUrl,
          protocolType: 'HTTP',
          parameterFormatType: 'JSON',
          addressingFormatType: 'ipaddress',
          httpAuthenticationMethod: 'none',
        },
      };

      await client.put('/ISAPI/Event/notification/httpHosts/1', subscriptionData, {
        params: { format: 'json' },
      });

      this.logger.log(`Subscribed to events from ${ipAddress} to ${callbackUrl}`);
      return true;
    } catch (error) {
      this.logger.error('Failed to subscribe to events', error);
      return false;
    }
  }
}